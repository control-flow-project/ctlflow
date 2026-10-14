using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Contracts;

public static class OperationContract
{
    public static Result<OperationRequest> Request(JsonElement value, bool stored = false)
    {
        if (!Validation.Fields(value, ["operationId", "target", "action", "expectedRevision"], stored ? ["releaseDirectory", "receiptPending", "status", "createdAt", "completedAt", "approval", "errors"] : ["releaseDirectory"]).IsSuccess) return Results.Fail<OperationRequest>("invalid", "Invalid lifecycle operation fields");
        var id = WireJson.Text(value, "operationId"); var target = value.GetProperty("target"); if (!Validation.Fields(target, ["kind"], ["fleetId", "instanceKey"]).IsSuccess) return Results.Fail<OperationRequest>("invalid", "Invalid lifecycle operation target");
        var kind = Validation.Choice(target.GetProperty("kind"), "fleet", "agent", "daemon"); var fleet = WireJson.Text(target, "fleetId"); var instance = WireJson.Text(target, "instanceKey"); var action = Validation.Choice(value.GetProperty("action"), "enroll", "start", "stop", "reset", "update"); var revision = Validation.Integer(value.GetProperty("expectedRevision")); var release = WireJson.Text(value, "releaseDirectory");
        if (target.TryGetProperty("fleetId", out _) && fleet is null || target.TryGetProperty("instanceKey", out _) && instance is null || value.TryGetProperty("releaseDirectory", out _) && release is null) return Results.Fail<OperationRequest>("invalid", "Optional operation identities and directories cannot be null or non-text");
        if (id is null || !Validation.Identifier(id) || !kind.IsSuccess || !action.IsSuccess || !revision.IsSuccess || kind.Value == "daemon" && (fleet is not null || instance is not null || action.Value != "stop") || kind.Value != "daemon" && (fleet is null || !Validation.Identifier(fleet)) || (kind.Value == "agent") != (instance is not null) || instance is not null && !IdentitySyntax.Name(instance) || (action.Value == "update") != (release is not null) || release is not null && !FleetConfigurationContract.Absolute(release)) return Results.Fail<OperationRequest>("invalid", "Invalid lifecycle operation identity, target or release directory");
        return Result<OperationRequest>.Success(new(id, new(kind.Value, fleet, instance), action.Value, revision.Value, release));
    }
    public static Result<FleetOperation> Parse(JsonElement value)
    {
        var request = Request(value, true); if (!request.IsSuccess) return Result<FleetOperation>.Fail(request.Error);
        if (!value.TryGetProperty("status", out var status) || !value.TryGetProperty("createdAt", out var created) || !value.TryGetProperty("completedAt", out var completed) || !value.TryGetProperty("approval", out var approval) || !value.TryGetProperty("errors", out var errors)) return Results.Fail<FleetOperation>("invalid", "Incomplete retained lifecycle operation");
        var phase = Validation.Choice(status, "accepted", "running", "awaiting-approval", "succeeded", "failed"); var at = Validation.Integer(created); var ended = Validation.NullableInteger(completed); var pinned = value.TryGetProperty("receiptPending", out var pin); if (pinned && pin.ValueKind != JsonValueKind.True) return Results.Fail<FleetOperation>("invalid", "Only unacknowledged controller requests are pinned");
        ApprovalLink? link = null;
        if (approval.ValueKind != JsonValueKind.Null) { if (!Validation.Fields(approval, ["url", "code"]).IsSuccess || !Validation.Text(approval.GetProperty("url"), 2048).IsSuccess || !Validation.Text(approval.GetProperty("code"), 12, 12).IsSuccess) return Results.Fail<FleetOperation>("invalid", "Invalid enrollment approval"); link = new(WireJson.Text(approval, "url")!, WireJson.Text(approval, "code")!); }
        var failures = Validation.List(errors, error =>
        { if (!Validation.Fields(error, ["instanceKey", "code", "message"]).IsSuccess) return Results.Fail<OperationError>("invalid", "Invalid operation failure"); var instance = Validation.NullableText(error.GetProperty("instanceKey"), 40); var code = Validation.Text(error.GetProperty("code"), 100); var message = Validation.Text(error.GetProperty("message"), 4096); return instance.IsSuccess && (instance.Value is null || IdentitySyntax.Name(instance.Value)) && code.IsSuccess && message.IsSuccess ? Result<OperationError>.Success(new(instance.Value, code.Value, message.Value)) : Results.Fail<OperationError>("invalid", "Invalid operation failure fields"); }, 100);
        return phase.IsSuccess && at.IsSuccess && ended.IsSuccess && failures.IsSuccess ? Result<FleetOperation>.Success(new(request.Value, phase.Value, at.Value, ended.Value, link, failures.Value, pinned)) : Results.Fail<FleetOperation>("invalid", "Invalid retained operation state");
    }
}
