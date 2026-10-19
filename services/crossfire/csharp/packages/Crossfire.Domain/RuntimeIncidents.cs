using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record RuntimeIncident(string Id, string OwnerId, string? AgentId, string? FleetId, string? RunId, string? SessionId,
    string Kind, string Message, long CreatedAt, long? RecoveredAt);
public sealed record IncidentNotification(string IncidentId, string Phase, string Body, long NextAttemptAt, string? EventId);
public sealed record ManagementConversation(string OwnerId, string RoomId, long CreatedAt);
public sealed record IncidentPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, Result<RuntimeIncident?>> Find, Func<string?, string?, Result<IReadOnlyList<RuntimeIncident>>> Active,
    Func<RuntimeIncident, Result<Unit>> Insert, Func<string, long, Result<Unit>> MarkRecovered,
    Func<string, string, Result<IncidentNotification?>> Notification, Func<IncidentNotification, bool, Result<Unit>> SaveNotification,
    Func<long, Result<IReadOnlyList<IncidentNotification>>> Due, Func<string?, string?, Result<string?>> ControllerName,
    Func<string, Result<ManagementConversation?>> Conversation, Func<ManagementConversation, Result<Unit>> SaveConversation,
    MessagingPorts Messaging, string PublicOrigin, string ServiceBackendUserId);

public static class RuntimeIncidents
{
    public static Result<Unit> Report(FleetPorts fleetPorts, IncidentPorts ports, FleetActor actor, string fleetId, string episodeId, string agentId, string? sessionId, string message)
        => fleetPorts.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(fleetPorts, actor, fleetId, true);
            if (!fleet.IsSuccess) return Result<Unit>.Fail(fleet.Error);
            if (actor is not FleetControllerActor) return Results.Fail<Unit>("forbidden", "An authenticated fleet controller is required");
            var agent = ports.Authorization.AgentView(agentId); var binding = ports.Authorization.Binding(agentId);
            if (!agent.IsSuccess) return Result<Unit>.Fail(agent.Error);
            if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
            if (agent.Value is null || agent.Value.Agent.OwnerId != fleet.Value.OwnerId || binding.Value is null || binding.Value.RetiredAt is not null
                || binding.Value.OwnerId != fleet.Value.OwnerId || binding.Value.FleetKey != fleet.Value.FleetKey) return Results.Fail<Unit>("missing", "Fleet instance not found");
            return Open(ports, new(episodeId, fleet.Value.OwnerId, agentId, null, null, sessionId, "failure", agent.Value.Name + " (" + agent.Value.OwnerMember.DisplayName + ") failed: " + message, ports.Authorization.Now(), null));
        });

    public static Result<Unit> Open(IncidentPorts ports, RuntimeIncident input)
    {
        var existing = ports.Find(input.Id);
        if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
        if (existing.Value is not null) return existing.Value.OwnerId == input.OwnerId && existing.Value.AgentId == input.AgentId
            && existing.Value.FleetId == input.FleetId && existing.Value.RunId == input.RunId && existing.Value.SessionId == input.SessionId
            && existing.Value.Kind == input.Kind && existing.Value.Message == input.Message ? Results.Done() : Results.Fail<Unit>("conflict", "Incident identity changed");
        var active = ports.Active(input.AgentId, input.FleetId);
        if (!active.IsSuccess) return Result<Unit>.Fail(active.Error);
        if (active.Value.Any(value => value.AgentId == input.AgentId && value.FleetId == input.FleetId && value.SessionId == input.SessionId && value.Kind == input.Kind)) return Results.Done();
        var controller = ports.ControllerName(input.AgentId, input.FleetId);
        if (!controller.IsSuccess) return Result<Unit>.Fail(controller.Error);
        var saved = ports.Insert(input);
        if (!saved.IsSuccess) return saved;
        var observed = DateTimeOffset.FromUnixTimeMilliseconds(ports.Authorization.Now()).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
        return ports.SaveNotification(new(input.Id, "initial", input.Message + "\nObserved " + observed
            + (controller.Value is null ? "\nDirect connection" : "\nController: " + controller.Value)
            + "\n" + ports.PublicOrigin + "/manage/" + (input.AgentId is null ? "fleets/" + input.FleetId : "agents/" + input.AgentId + "/activity"), ports.Authorization.Now(), null), true);
    }

    public static Result<Unit> Recover(IncidentPorts ports, string? agentId, string? fleetId, string? sessionId = null, string? kind = null)
    {
        var previous = ports.Active(agentId, fleetId);
        if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error);
        foreach (var value in previous.Value.Where(value => value.AgentId == agentId && value.FleetId == fleetId && (kind is null || value.Kind == kind)
            && (value.Kind == "contact" || value.SessionId is null || value.SessionId == sessionId)))
        {
            var saved = ports.MarkRecovered(value.Id, ports.Authorization.Now());
            if (!saved.IsSuccess) return saved;
            var notice = ports.SaveNotification(new(value.Id, "recovery", (value.Kind == "contact" ? "Contact restored." : "Native execution resumed.")
                + "\n" + value.Message, ports.Authorization.Now(), null), true);
            if (!notice.IsSuccess) return notice;
        }
        return Results.Done();
    }

    public static async ValueTask<Result<Unit>> Deliver(IncidentPorts ports, CancellationToken cancellation = default)
    {
        var pending = ports.Due(ports.Authorization.Now());
        if (!pending.IsSuccess) return Result<Unit>.Fail(pending.Error);
        foreach (var notice in pending.Value)
        {
            cancellation.ThrowIfCancellationRequested();
            if (notice.Phase == "recovery")
            {
                var initial = ports.Notification(notice.IncidentId, "initial");
                if (!initial.IsSuccess) return Result<Unit>.Fail(initial.Error);
                if (initial.Value?.EventId is null) continue;
            }
            var incident = ports.Find(notice.IncidentId);
            if (!incident.IsSuccess) return Result<Unit>.Fail(incident.Error);
            if (incident.Value is null) return Results.Fail<Unit>("missing", "Incident not found");
            var owner = ports.Authorization.Principal(incident.Value.OwnerId);
            if (!owner.IsSuccess) return Result<Unit>.Fail(owner.Error);
            if (owner.Value?.Status != "active") continue;
            var previous = ports.Conversation(owner.Value.Id);
            if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error);
            if (previous.Value is null)
            {
                var named = await ports.Messaging.SetDisplayName(ports.ServiceBackendUserId, "crossfire", cancellation);
                if (!named.IsSuccess) continue;
            }
            var conversation = await ports.Messaging.OwnerConversation(owner.Value.BackendUserId, ports.ServiceBackendUserId, previous.Value?.RoomId, null, cancellation);
            if (!conversation.IsSuccess)
            {
                var delayed = ports.Transaction.Run(() => ports.SaveNotification(notice with { NextAttemptAt = ports.Authorization.Now() + 30000 }, false));
                if (!delayed.IsSuccess) return delayed;
                continue;
            }
            if (previous.Value is null)
            {
                var saved = ports.Transaction.Run(() => ports.SaveConversation(new(owner.Value.Id, conversation.Value, ports.Authorization.Now())));
                if (!saved.IsSuccess) continue;
            }
            var sent = await ports.Messaging.SendNotice(ports.ServiceBackendUserId, conversation.Value, "incident-" + notice.IncidentId + "-" + notice.Phase, notice.Body, owner.Value.BackendUserId, cancellation);
            var recorded = ports.Transaction.Run(() => ports.SaveNotification(notice with { NextAttemptAt = ports.Authorization.Now() + 30000, EventId = sent.IsSuccess ? sent.Value : null }, false));
            if (!recorded.IsSuccess) return recorded;
        }
        return Results.Done();
    }
}
