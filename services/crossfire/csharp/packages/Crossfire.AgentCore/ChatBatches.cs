using System.Text;
using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record ChatBatch(IReadOnlyList<ReceivedEvent> Events, string Text, string MessageId, int Messages, string? Room);
public static class ChatBatches
{
    public static JsonElement Envelope(IReadOnlyList<ReceivedEvent> events, AgentSettings settings, IReadOnlyDictionary<string, PrincipalIdentity> identities)
        => WireJson.Object(writer =>
        {
            writer.WriteString("instance", settings.Instance); writer.WriteString("owner", settings.Owner); writer.WriteStartArray("events"); foreach (var value in events) ReceivedEvents.Encode(value).WriteTo(writer); writer.WriteEndArray(); writer.WriteStartObject("senders");
            foreach (var sender in events.Select(value => value.Sender).Distinct(StringComparer.Ordinal))
            {
                if (!identities.TryGetValue(sender, out var identity) || identity.MatrixUserId != sender) throw new InvalidDataException("Missing verified sender identity");
                var relationship = sender == settings.Owner ? "owner" : identity.Kind == "human" ? "other-human" : identity.Kind == "agent" ? identity.OwnerMatrixId == settings.Owner ? "owners-agent" : "other-owners-agent" : "unknown";
                writer.WriteStartObject(sender); writer.WriteString("kind", identity.Kind); writer.WriteString("display_name", identity.DisplayName); writer.WriteString("relationship", relationship);
                if (identity.Kind == "agent") { writer.WriteString("owner", identity.OwnerMatrixId); writer.WriteString("owner_display_name", identity.OwnerDisplayName); } writer.WriteEndObject();
            }
            writer.WriteEndObject();
        });
    public static IReadOnlyList<ChatBatch> Prepare(IReadOnlyList<ReceivedEvent> events, AgentSettings settings, IReadOnlyDictionary<string, PrincipalIdentity> identities,
        int maximum, NativeHistoryMode mode, MessageArtifacts artifacts)
    {
        if (maximum is < 1024 or > AgentIO.MaximumInputBytes) throw new InvalidDataException("Invalid native input budget"); var result = new List<ChatBatch>();
        IEnumerable<IReadOnlyList<ReceivedEvent>> groups = mode == NativeHistoryMode.PerRoom ? events.GroupBy(value => value.RoomId, StringComparer.Ordinal).Select(group => (IReadOnlyList<ReceivedEvent>)group.ToArray()) : [events];
        foreach (var group in groups)
        {
            if (group.Count == 0) continue;
            var identity = WireJson.Array(writer => { writer.WriteStringValue(settings.Instance); foreach (var value in group) { writer.WriteStartArray(); writer.WriteStringValue(value.RoomId); writer.WriteStringValue(value.EventId); writer.WriteEndArray(); } });
            var id = "crossfire-" + Identity.Hash(WireJson.Compact(identity)); var envelope = Envelope(group, settings, identities);
            var metadata = WireJson.Object(writer => { foreach (var field in envelope.EnumerateObject()) if (field.Name != "events") field.WriteTo(writer); });
            var text = artifacts.Prepare(group, UnreadMessages.Prefix + WireJson.Compact(envelope), id, maximum, metadata); if (Encoding.UTF8.GetByteCount(text) > maximum) throw new InvalidDataException("Large input requires a private message artifact store");
            result.Add(new(group, text, id, group.Count(value => value.Type == "m.room.message"), mode == NativeHistoryMode.PerRoom ? group[0].RoomId : null));
        }
        return result;
    }
}
