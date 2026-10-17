using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record WakeAttachment(string RunId, string SessionId);
public sealed record WakeDelivery(string Id, string RuleId, string AgentId, long RuleRevision, string RunId, string SessionId, long ScheduledAt, long CreatedAt, string Status, long? DeliveredAt);
public sealed record DueWake(WakeRule Rule, WakeAssignment Assignment);
public sealed record ScheduledWake(string DeliveryId, string RuleId, long RuleRevision, string Name, string Message, long ScheduledAt, string SessionId, string OwnerMatrixId, string AuthorizerMatrixId);
public sealed record WakeMetadata(long Now, long? NextDueAt);
public sealed record WakeDeliveryPorts(WakeRulePorts Rules, ListenerPorts Listener,
    Func<string, Result<WakeDelivery?>> Find, Func<string, Result<WakeDelivery?>> Pending, Func<WakeDelivery, bool, Result<Unit>> Save,
    Func<string, long, Result<IReadOnlyList<DueWake>>> Due, Func<string, Result<long?>> NextDueAt, Func<string> Identifier);

public static class WakeDeliveries
{
    private static Result<Unit> Attachment(WakeAttachment input)
        => input.SessionId.Length is >= 1 and <= 200 && !input.SessionId.Any(value => value is <= '\u001f' or '\u007f') ? Results.Done() : Results.Fail<Unit>("invalid", "Invalid native session identity");

    private static Result<Unit> Receiver(WakeDeliveryPorts ports, Actor actor, string agentId)
    {
        var authority = Authorization.Require(ports.Rules.Discovery.Authorization, actor, "wake-delivery.receive.self"); if (!authority.IsSuccess) return Result<Unit>.Fail(authority.Error);
        return actor.Kind == "agent" && actor.PrincipalId == agentId ? Results.Done() : Results.Fail<Unit>("missing", "Wake-up receiver not found");
    }

    private static Result<ListenerRun> Run(WakeDeliveryPorts ports, Actor actor, string agentId, string runId)
    {
        var receiver = Receiver(ports, actor, agentId); if (!receiver.IsSuccess) return Result<ListenerRun>.Fail(receiver.Error);
        var run = ports.Listener.Find(runId); if (!run.IsSuccess) return Result<ListenerRun>.Fail(run.Error);
        return run.Value?.AgentId == agentId ? Result<ListenerRun>.Success(run.Value) : Results.Fail<ListenerRun>("missing", "Listener run not found");
    }

    private static Result<bool> Live(WakeDeliveryPorts ports, Actor actor, string agentId, string runId)
    {
        var run = Run(ports, actor, agentId, runId); if (!run.IsSuccess) return Result<bool>.Fail(run.Error);
        var now = ports.Rules.Discovery.Authorization.Now();
        if (run.Value.StoppedAt is not null || run.Value.DisconnectRequestedAt is not null || run.Value.LastSeenAt < now - ControllerAdmission.HeartbeatExpiryMs || run.Value.Controller is null) return Result<bool>.Success(false);
        var controller = run.Value.Controller;
        return ports.Listener.Facts(agentId, controller.FleetId, controller.CredentialId).Map(value => ControllerAdmission.Admits(run.Value, value, now, ControllerPurpose.Delivery));
    }

    private static Result<bool> Allowed(WakeDeliveryPorts ports, WakeRule rule, string agentId)
    {
        if (!rule.Enabled) return Result<bool>.Success(false);
        var authorization = ports.Rules.Discovery.Authorization;
        var owner = authorization.Principal(rule.OwnerId); if (!owner.IsSuccess) return Result<bool>.Fail(owner.Error);
        var authorizer = authorization.Principal(rule.ConfiguredById); if (!authorizer.IsSuccess) return Result<bool>.Fail(authorizer.Error);
        if (owner.Value?.Status != "active" || authorizer.Value?.Status != "active") return Result<bool>.Success(false);
        var agent = authorization.Agent(agentId); if (!agent.IsSuccess) return Result<bool>.Fail(agent.Error);
        if (agent.Value is null) return Result<bool>.Success(false);
        return authorization.Permissions(rule.ConfiguredById).Map(values => values.Contains("agent.configure.any", StringComparer.Ordinal) || agent.Value.OwnerId == rule.ConfiguredById && values.Contains("agent.configure.owned", StringComparer.Ordinal));
    }

    private static Result<ScheduledWake> Command(WakeDeliveryPorts ports, WakeRule rule, WakeDelivery delivery)
    {
        var owner = ports.Rules.Discovery.Authorization.Principal(rule.OwnerId); if (!owner.IsSuccess) return Result<ScheduledWake>.Fail(owner.Error);
        var authorizer = ports.Rules.Discovery.Authorization.Principal(rule.ConfiguredById); if (!authorizer.IsSuccess) return Result<ScheduledWake>.Fail(authorizer.Error);
        return owner.Value is null || authorizer.Value is null ? Results.Fail<ScheduledWake>("unavailable", "Wake-up authority is missing")
            : Result<ScheduledWake>.Success(new(delivery.Id, rule.Id, delivery.RuleRevision, rule.Name, rule.Message, delivery.ScheduledAt, delivery.SessionId, owner.Value.MatrixUserId, authorizer.Value.MatrixUserId));
    }

    public static Result<WakeMetadata> Metadata(WakeDeliveryPorts ports, Actor actor, string agentId, WakeAttachment input)
    {
        var parsed = Attachment(input); if (!parsed.IsSuccess) return Result<WakeMetadata>.Fail(parsed.Error);
        var live = Live(ports, actor, agentId, input.RunId); if (!live.IsSuccess) return Result<WakeMetadata>.Fail(live.Error);
        var next = ports.NextDueAt(agentId); if (!next.IsSuccess) return Result<WakeMetadata>.Fail(next.Error);
        var pending = ports.Pending(agentId); if (!pending.IsSuccess) return Result<WakeMetadata>.Fail(pending.Error);
        var now = ports.Rules.Discovery.Authorization.Now();
        return Result<WakeMetadata>.Success(new(now, live.Value && pending.Value?.SessionId == input.SessionId ? now : next.Value));
    }

    public static Result<ScheduledWake?> Claim(WakeDeliveryPorts ports, Actor actor, string agentId, WakeAttachment input)
        => ports.Rules.Transaction.Run(() =>
        {
            var parsed = Attachment(input); if (!parsed.IsSuccess) return Result<ScheduledWake?>.Fail(parsed.Error);
            var live = Live(ports, actor, agentId, input.RunId); if (!live.IsSuccess) return Result<ScheduledWake?>.Fail(live.Error);
            if (!live.Value) return Result<ScheduledWake?>.Success(null);
            var pending = ports.Pending(agentId); if (!pending.IsSuccess) return Result<ScheduledWake?>.Fail(pending.Error);
            var now = ports.Rules.Discovery.Authorization.Now();
            if (pending.Value is { } previous)
            {
                if (previous.SessionId != input.SessionId) return Result<ScheduledWake?>.Success(null);
                if (previous.RunId != input.RunId)
                {
                    var original = ports.Listener.Find(previous.RunId); if (!original.IsSuccess) return Result<ScheduledWake?>.Fail(original.Error);
                    if (original.Value is { StoppedAt: null } && original.Value.LastSeenAt >= now - ControllerAdmission.HeartbeatExpiryMs) return Result<ScheduledWake?>.Success(null);
                }
                var rule = ports.Rules.Find(previous.RuleId); if (!rule.IsSuccess) return Result<ScheduledWake?>.Fail(rule.Error);
                if (rule.Value is null) return Results.Fail<ScheduledWake?>("unavailable", "Wake-up rule is missing");
                var eligible = Allowed(ports, rule.Value, agentId); if (!eligible.IsSuccess) return Result<ScheduledWake?>.Fail(eligible.Error);
                if (!eligible.Value || rule.Value.Revision != previous.RuleRevision) return ports.Save(previous with { Status = "cancelled" }, false).Map<ScheduledWake?>(_ => null);
                var transferred = previous with { RunId = input.RunId }; var saved = ports.Save(transferred, false); if (!saved.IsSuccess) return Result<ScheduledWake?>.Fail(saved.Error);
                return Command(ports, rule.Value, transferred).Map<ScheduledWake?>(value => value);
            }
            var due = ports.Due(agentId, now); if (!due.IsSuccess) return Result<ScheduledWake?>.Fail(due.Error);
            foreach (var item in due.Value)
            {
                var after = item.Rule.Schedule is IntervalSchedule interval ? checked(item.Assignment.NextDueAt + (now - item.Assignment.NextDueAt) / (interval.Seconds * 1000) * (interval.Seconds * 1000)) : now;
                var next = ports.Rules.Next(item.Rule.Schedule, after); if (!next.IsSuccess) return Result<ScheduledWake?>.Fail(next.Error);
                var advanced = ports.Rules.SaveAssignment(item.Assignment with { NextDueAt = next.Value }); if (!advanced.IsSuccess) return Result<ScheduledWake?>.Fail(advanced.Error);
                var eligible = Allowed(ports, item.Rule, agentId); if (!eligible.IsSuccess) return Result<ScheduledWake?>.Fail(eligible.Error);
                if (!eligible.Value) continue;
                var delivery = new WakeDelivery(ports.Identifier(), item.Rule.Id, agentId, item.Rule.Revision, input.RunId, input.SessionId, item.Assignment.NextDueAt, now, "pending", null);
                var saved = ports.Save(delivery, true); if (!saved.IsSuccess) return Result<ScheduledWake?>.Fail(saved.Error);
                return Command(ports, item.Rule, delivery).Map<ScheduledWake?>(value => value);
            }
            return Result<ScheduledWake?>.Success(null);
        });

    public static Result<bool> Validate(WakeDeliveryPorts ports, Actor actor, string agentId, string deliveryId, WakeAttachment input)
    {
        var live = Live(ports, actor, agentId, input.RunId); if (!live.IsSuccess || !live.Value) return live;
        var delivery = ports.Find(deliveryId); if (!delivery.IsSuccess) return Result<bool>.Fail(delivery.Error);
        if (delivery.Value is not { Status: "pending" } current || current.AgentId != agentId || current.RunId != input.RunId || current.SessionId != input.SessionId) return Result<bool>.Success(false);
        var rule = ports.Rules.Find(current.RuleId); if (!rule.IsSuccess) return Result<bool>.Fail(rule.Error);
        return rule.Value is null || rule.Value.Revision != current.RuleRevision ? Result<bool>.Success(false) : Allowed(ports, rule.Value, agentId);
    }

    public static Result<bool> Acknowledge(WakeDeliveryPorts ports, Actor actor, string agentId, string deliveryId, WakeAttachment input)
        => ports.Rules.Transaction.Run(() =>
        {
            var parsed = Attachment(input); if (!parsed.IsSuccess) return Result<bool>.Fail(parsed.Error);
            var receiver = Receiver(ports, actor, agentId); if (!receiver.IsSuccess) return Result<bool>.Fail(receiver.Error);
            var delivery = ports.Find(deliveryId); if (!delivery.IsSuccess) return Result<bool>.Fail(delivery.Error);
            if (delivery.Value is null) return Result<bool>.Success(false);
            var run = Run(ports, actor, agentId, input.RunId); if (!run.IsSuccess) return Result<bool>.Fail(run.Error);
            var current = delivery.Value;
            if (current.AgentId != agentId || current.RunId != input.RunId || current.SessionId != input.SessionId) return Results.Fail<bool>("missing", "Wake-up receipt not found");
            if (current.Status == "delivered") return Result<bool>.Success(true);
            var now = ports.Rules.Discovery.Authorization.Now(); var saved = ports.Save(current with { Status = "delivered", DeliveredAt = now }, false); if (!saved.IsSuccess) return Result<bool>.Fail(saved.Error);
            var assignments = ports.Rules.Assignments([current.RuleId]); if (!assignments.IsSuccess) return Result<bool>.Fail(assignments.Error);
            var assignment = assignments.Value.SingleOrDefault(value => value.AgentId == agentId); if (assignment is null) return Results.Fail<bool>("unavailable", "Wake-up assignment is missing");
            return ports.Rules.SaveAssignment(assignment with { LastDeliveredAt = Math.Max(now, assignment.LastDeliveredAt ?? 0) }).Map(_ => true);
        });
}
