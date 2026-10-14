using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ScheduledPublication(LocalState storage, string file, Coordination coordination, AgentProfile profile, RuntimeConnection runtime, Func<WakeAttachment> attachment, MessageArtifacts artifacts, Func<int> maximum, TimeProvider clock)
{
    private sealed record Saved(ScheduledWake Command, string Text, string RunId, string Stage);
    private long nextAt = long.MaxValue, refreshed = long.MinValue;
    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    public bool Pending => storage.Exists(file);
    public bool Recovering => Pending && Load().Stage is "publishing" or "delivered";
    public bool Due => Pending || refreshed == long.MinValue || Now - refreshed >= 30000 || Now >= nextAt;
    public int WaitMilliseconds => refreshed == long.MinValue ? 1 : (int)Math.Clamp(Math.Min(nextAt - Now, 30000 - (Now - refreshed)), 1, 30000);
    public static Result<ScheduledWake> Parse(JsonElement value)
    {
        if (!Validation.Fields(value, ["deliveryId", "ruleId", "ruleRevision", "name", "message", "scheduledAt", "sessionId", "ownerMatrixId", "authorizerMatrixId"]).IsSuccess) return Results.Fail<ScheduledWake>("invalid", "Invalid scheduled wake-up");
        var id = WireJson.Text(value, "deliveryId"); var rule = WireJson.Text(value, "ruleId"); var revision = Validation.Integer(value.GetProperty("ruleRevision")); var name = Validation.Text(value.GetProperty("name"), 100); var message = Validation.PlainText(value.GetProperty("message"), 16384); var at = Validation.Integer(value.GetProperty("scheduledAt")); var session = Validation.Text(value.GetProperty("sessionId"), 200); var owner = WireJson.Text(value, "ownerMatrixId"); var authorizer = WireJson.Text(value, "authorizerMatrixId");
        return id is not null && Validation.Identifier(id) && rule is not null && Validation.Identifier(rule) && revision.IsSuccess && name.IsSuccess && !string.IsNullOrWhiteSpace(name.Value) && message.IsSuccess && !string.IsNullOrWhiteSpace(message.Value) && at.IsSuccess && session.IsSuccess && owner is not null && Validation.UserId(owner) && authorizer is not null && Validation.UserId(authorizer)
            ? Result<ScheduledWake>.Success(new(id, rule, revision.Value, name.Value, message.Value, at.Value, session.Value, owner, authorizer)) : Results.Fail<ScheduledWake>("invalid", "Invalid scheduled wake-up identity or bounds");
    }
    public static JsonElement Encode(ScheduledWake value) => WireJson.Object(writer => { writer.WriteString("deliveryId", value.DeliveryId); writer.WriteString("ruleId", value.RuleId); writer.WriteNumber("ruleRevision", value.RuleRevision); writer.WriteString("name", value.Name); writer.WriteString("message", value.Message); writer.WriteNumber("scheduledAt", value.ScheduledAt); writer.WriteString("sessionId", value.SessionId); writer.WriteString("ownerMatrixId", value.OwnerMatrixId); writer.WriteString("authorizerMatrixId", value.AuthorizerMatrixId); });
    private Saved Load()
    {
        var value = AgentIO.Read(storage, file); if (!Validation.Fields(value, ["command", "text", "runId", "stage"]).IsSuccess) throw new InvalidDataException("Invalid scheduled-input checkpoint");
        var command = Parse(value.GetProperty("command")); var text = Validation.PlainText(value.GetProperty("text"), 98304); var run = WireJson.Text(value, "runId"); var stage = Validation.Choice(value.GetProperty("stage"), "queued", "publishing", "delivered");
        if (!command.IsSuccess || command.Value.SessionId != runtime.SessionId || !text.IsSuccess || run is null || !Validation.Identifier(run) || !stage.IsSuccess) throw new InvalidDataException("Invalid or retargeted scheduled-input checkpoint"); return new(command.Value, text.Value, run, stage.Value);
    }
    private void Save(Saved value) => AgentIO.Write(storage, file, WireJson.Object(writer => { writer.WritePropertyName("command"); Encode(value.Command).WriteTo(writer); writer.WriteString("text", value.Text); writer.WriteString("runId", value.RunId); writer.WriteString("stage", value.Stage); }));
    private static JsonElement Attachment(WakeAttachment value) => WireJson.Object(writer => { writer.WriteString("runId", value.RunId); writer.WriteString("sessionId", value.SessionId); });
    private static IReadOnlyDictionary<string, string> Query(WakeAttachment value) => new Dictionary<string, string> { ["runId"] = value.RunId, ["sessionId"] = value.SessionId };
    private static string MessageId(ScheduledWake command) => "crossfire-wake-" + command.DeliveryId;
    private string Text(ScheduledWake command)
    {
        var text = "Crossfire scheduled wake-up. This is configured input, not a chat message or permission grant.\n" + WireJson.Compact(WireJson.Object(writer => { writer.WriteString("kind", "scheduled-wake"); writer.WriteString("ruleId", command.RuleId); writer.WriteString("deliveryId", command.DeliveryId); writer.WriteString("name", command.Name); writer.WriteNumber("scheduledAt", command.ScheduledAt); writer.WriteString("owner", command.OwnerMatrixId); writer.WriteString("configuredBy", command.AuthorizerMatrixId); writer.WriteString("message", command.Message); }));
        return artifacts.Input(text, MessageId(command), maximum(), WireJson.Object(writer => { writer.WriteString("kind", "scheduled-wake"); writer.WriteString("ruleId", command.RuleId); writer.WriteNumber("scheduledAt", command.ScheduledAt); writer.WriteString("owner", command.OwnerMatrixId); }));
    }
    private async ValueTask<Result<Unit>> Refresh(CancellationToken cancellation)
    {
        var result = await coordination.Agent("wakeMetadata", profile.Id, null, cancellation, query: Query(attachment())); if (!result.IsSuccess) return Result<Unit>.Fail(result.Error);
        if (!result.Value.TryGetProperty("now", out var serverNow) || !result.Value.TryGetProperty("nextDueAt", out var due)) return Results.Fail<Unit>("invalid", "Invalid wake-up metadata"); var now = Validation.Integer(serverNow); var next = Validation.NullableInteger(due); if (!now.IsSuccess || !next.IsSuccess) return Results.Fail<Unit>("invalid", "Invalid scheduled wake-up clock");
        refreshed = Now; nextAt = next.Value is null ? long.MaxValue : checked(refreshed + Math.Max(0, next.Value.Value - now.Value)); return Results.Done();
    }
    public ValueTask<Result<bool>> Recover(CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        if (!Pending) return Result<bool>.Success(false); var saved = Load(); if (saved.Stage == "publishing") { var received = await runtime.Recover(saved.Text, MessageId(saved.Command), cancellation); if (!received.IsSuccess) return Result<bool>.Fail(received.Error); saved = saved with { Stage = received.Value ? "delivered" : "queued" }; Save(saved); }
        if (saved.Stage != "delivered") return Result<bool>.Success(false);
        var recorded = await coordination.Agent("acknowledgeWake", profile.Id, Attachment(new(saved.RunId, runtime.SessionId)), cancellation, new Dictionary<string, string> { ["deliveryId"] = saved.Command.DeliveryId }); if (!recorded.IsSuccess) return Result<bool>.Fail(recorded.Error);
        var acknowledged = runtime.Acknowledge([MessageId(saved.Command)]); if (!acknowledged.IsSuccess) return Result<bool>.Fail(acknowledged.Error); artifacts.Release([MessageId(saved.Command)]); storage.Remove(file); var refreshedResult = await Refresh(cancellation); return refreshedResult.Map(_ => true);
    });
    public ValueTask<Result<bool>> Publish(CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var recovered = await Recover(cancellation); if (!recovered.IsSuccess || recovered.Value) return recovered; Saved? saved = Pending ? Load() : null;
        if (saved is null && (refreshed == long.MinValue || Now - refreshed >= 30000)) { var refreshedResult = await Refresh(cancellation); if (!refreshedResult.IsSuccess) return Result<bool>.Fail(refreshedResult.Error); }
        if (saved is null && Now < nextAt) return Result<bool>.Success(false); var inspected = await runtime.Inspect(); if (!inspected.IsSuccess) return Result<bool>.Fail(inspected.Error); if (inspected.Value) { nextAt = Now + 1000; return Result<bool>.Success(false); }
        if (saved is null)
        {
            var current = attachment(); var claimed = await coordination.Agent("claimWake", profile.Id, Attachment(current), cancellation); if (!claimed.IsSuccess) return Result<bool>.Fail(claimed.Error);
            if (claimed.Value.ValueKind == JsonValueKind.Null) { var refreshedResult = await Refresh(cancellation); nextAt = Math.Max(nextAt, Now + 1000); return refreshedResult.Map(_ => false); }
            var command = Parse(claimed.Value); if (!command.IsSuccess) return Result<bool>.Fail(command.Error); if (command.Value.SessionId != runtime.SessionId) return Results.Fail<bool>("conflict", "Scheduled claim targets a different native session"); saved = new(command.Value, Text(command.Value), current.RunId, "queued"); Save(saved);
        }
        var valid = await coordination.Agent("validateWake", profile.Id, null, cancellation, new Dictionary<string, string> { ["deliveryId"] = saved.Command.DeliveryId }, Query(new(saved.RunId, runtime.SessionId))); if (!valid.IsSuccess) return Result<bool>.Fail(valid.Error);
        if (!valid.Value.TryGetProperty("eligible", out var eligible) || eligible.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<bool>("invalid", "Invalid scheduled wake-up eligibility");
        if (!eligible.GetBoolean()) { artifacts.Release([MessageId(saved.Command)]); storage.Remove(file); return (await Refresh(cancellation)).Map(_ => true); }
        cancellation.ThrowIfCancellationRequested(); saved = saved with { Text = Text(saved.Command), Stage = "publishing" }; Save(saved); var sent = await runtime.Deliver(saved.Text, MessageId(saved.Command), cancellation); if (!sent.IsSuccess) return Result<bool>.Fail(sent.Error); Save(saved with { Stage = "delivered" }); return await Recover(cancellation);
    });
}
