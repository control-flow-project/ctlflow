using Crossfire.Domain;
using System.Globalization;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record SourceControl(string Room, string Event, bool Stop, string? Turn, string Status);
public sealed record SourceControlState(string Thread, bool Paused, IReadOnlyList<SourceControl> Controls);
public static class SteeringControl
{
    public static bool SourceText(ReceivedEvent value, string sender) => value.Type == "message" && value.Sender == sender && value.Content.Kind == "text"
        && value.Content.Body is not null && !value.Content.Edited && !value.Content.Control;
    public static bool Mention(ReceivedEvent value, string self) => value.Content.Mentions.Contains(self, StringComparer.Ordinal);
    public static async ValueTask<Result<bool>> Authorized(MessagingClient messaging, Coordination coordination, AgentProfile profile, ReceivedEvent value, IReadOnlySet<string> senders, CancellationToken cancellation)
    {
        if (!SourceText(value, value.Sender) || value.Sender == profile.Account.UserId) return Result<bool>.Success(false); var mention = Mention(value, profile.Account.UserId); var pause = value.Sender == profile.Settings.Owner && value.Content.Body?.Trim() == "!!";
        if (!pause && (!senders.Contains(value.Sender) || !mention)) return Result<bool>.Success(false); var identities = await CoordinationValues.Senders(coordination, [value], cancellation); if (!identities.IsSuccess) return Result<bool>.Fail(identities.Error); if (identities.Value[value.Sender].Kind == "unknown") return Result<bool>.Success(false);
        var response = await messaging.JoinedMembers(value.RoomId, cancellation); if (!response.IsSuccess) return Result<bool>.Fail(response.Error);
        var members = response.Value; cancellation.ThrowIfCancellationRequested();
        return Result<bool>.Success(members.Contains(value.Sender) && members.Contains(profile.Account.UserId) && (mention || pause && members.Count == 2));
    }
    public static SourceControlState Load(LocalState storage, string file, string thread)
    {
        if (!storage.Exists(file)) return new(thread, false, []); var value = AgentIO.Read(storage, file); if (!Validation.Fields(value, ["thread", "paused", "controls"]).IsSuccess || WireJson.Text(value, "thread") != thread) throw new InvalidDataException("Invalid or different-thread control state");
        var paused = Validation.Boolean(value.GetProperty("paused")); var controls = Validation.List(value.GetProperty("controls"), source =>
        {
            if (!Validation.Fields(source, ["room", "event", "stop", "turn", "status"]).IsSuccess) return Results.Fail<SourceControl>("invalid", "Invalid retained source control");
            var room = WireJson.Text(source, "room"); var id = WireJson.Text(source, "event"); var stop = Validation.Boolean(source.GetProperty("stop")); var turn = Validation.NullableText(source.GetProperty("turn")); var status = Validation.Choice(source.GetProperty("status"), "interrupting", "interrupted", "delivered", "superseded");
            return room is not null && Validation.RoomId(room) && id is not null && Validation.EventId(id) && stop.IsSuccess && turn.IsSuccess && status.IsSuccess ? Result<SourceControl>.Success(new(room, id, stop.Value, turn.Value, status.Value)) : Results.Fail<SourceControl>("invalid", "Invalid retained source control fields");
        }, 1000);
        return paused.IsSuccess && controls.IsSuccess && controls.Value.Select(control => (control.Room, control.Event)).Distinct().Count() == controls.Value.Count ? new(thread, paused.Value, controls.Value) : throw new InvalidDataException("Invalid retained source controls");
    }
    public static void Save(LocalState storage, string file, SourceControlState value)
    {
        if (value.Controls.Count > 1000) throw new InvalidDataException("Uncheckpointed source controls exceed 1000; drain acknowledged history before continuing");
        AgentIO.Write(storage, file, WireJson.Object(writer => { writer.WriteString("thread", value.Thread); writer.WriteBoolean("paused", value.Paused); writer.WriteStartArray("controls"); foreach (var control in value.Controls) { writer.WriteStartObject(); writer.WriteString("room", control.Room); writer.WriteString("event", control.Event); writer.WriteBoolean("stop", control.Stop); writer.WriteString("turn", control.Turn); writer.WriteString("status", control.Status); writer.WriteEndObject(); } writer.WriteEndArray(); }));
    }
}
public sealed class SteeringReceipts(TimeProvider clock, Action<string, string> notice)
{
    private readonly Dictionary<(string Room, string Event), long> received = [];
    private readonly object gate = new();
    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    public void Publish(ReceivedEvent value, string stage, string? detail = null)
    {
        lock (gate)
        {
            var key = (value.RoomId, value.EventId); var now = Now; long? first = received.TryGetValue(key, out var previous) ? previous : stage == "received" ? now : null; if (stage == "received") received[key] = first ?? now;
            var label = stage switch { "received" => "Mention received", "interrupted" => "Captured turn interrupted", "already-idle" => "Already idle — no turn interrupted", "accepted" => "Native input accepted", "superseded" => "Steering superseded — retained as unread context", "failed" => "Steering failed — native acceptance not confirmed", _ => throw new ArgumentException("Unknown steering receipt stage", nameof(stage)) };
            var text = label + "\n" + WireJson.Compact(WireJson.Object(writer =>
            {
                writer.WriteString("eventId", value.EventId); writer.WriteStartObject("source"); writer.WriteString("kind", value.Origin.Kind); writer.WriteString("name", value.Origin.Name); writer.WriteString("alias", value.Origin.Alias); writer.WriteEndObject(); writer.WriteString("roomId", value.RoomId); writer.WriteString("sender", value.Sender); writer.WriteString("sentAt", value.Timestamp); writer.WriteString("receivedAt", first is null ? null : DateTimeOffset.FromUnixTimeMilliseconds(first.Value).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)); writer.WriteString("stageAt", clock.GetUtcNow().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)); AgentWire.Number(writer, "sinceReceiptMs", first is null ? null : Math.Max(0, now - first.Value)); AgentWire.Number(writer, "sinceSentMs", DateTimeOffset.TryParse(value.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out var sent) ? Math.Max(0, now - sent.ToUnixTimeMilliseconds()) : null);
                if (stage == "received") { var message = value.Content.Body ?? ""; writer.WriteString("message", TextRules.TruncateUtf16(message, 3000)); } if (detail is not null) writer.WriteString("detail", TextRules.TruncateUtf16(detail, 3000));
            }));
            notice(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue("steering"); writer.WriteStringValue(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(key.RoomId); writer.WriteStringValue(key.EventId); }))); writer.WriteStringValue(stage); })), text); if (stage is "accepted" or "superseded") received.Remove(key);
        }
    }
    public void Superseded(SourceControl control, ReceivedEvent replacement)
    {
        lock (gate) received.Remove((control.Room, control.Event));
        var key = WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(control.Room); writer.WriteStringValue(control.Event); }));
        notice(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue("steering"); writer.WriteStringValue(key); writer.WriteStringValue("superseded"); })), "Steering superseded by a newer mention. Confirmed input remains in native history; unconfirmed input remains unread.\n" + WireJson.Compact(WireJson.Object(writer => { writer.WriteString("roomId", control.Room); writer.WriteString("eventId", control.Event); writer.WriteString("replacedBy", replacement.EventId); writer.WriteString("stageAt", clock.GetUtcNow().ToString("O", CultureInfo.InvariantCulture)); })));
    }
}
