using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class ListenerQueries
{
    public static Result<Unit> Live(CrossfireDbContext context, string agentId, string runId, long now)
    {
        var found = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(row => row.Id == runId)
            .Select(row => new ListenerRun(row.Id, row.AgentId, row.Release, row.ControllerFleetId == null || row.ControllerConnectionId == null || row.ControllerCredentialId == null
                ? null : new ListenerController(row.ControllerFleetId, row.ControllerConnectionId, row.ControllerCredentialId), row.StartedAt, row.LastSeenAt,
                row.ActiveMs, row.MessagesDelivered, row.StoppedAt, row.DisconnectRequestedAt)).SingleOrDefault());
        if (!found.IsSuccess) return Result<Unit>.Fail(found.Error);
        if (found.Value is null || found.Value.AgentId != agentId || found.Value.StoppedAt is not null || found.Value.DisconnectRequestedAt is not null
            || found.Value.LastSeenAt + ControllerAdmission.HeartbeatExpiryMs <= now)
            return Results.Fail<Unit>("conflict", "The original listener is no longer available");
        var controller = found.Value.Controller;
        if (controller is null) return Results.Fail<Unit>("conflict", "The original controller lease is no longer available");
        var fleetId = controller.FleetId; var credentialId = controller.CredentialId;
        var facts = Stored.Read(() => context.FleetInstance.AsNoTracking().Where(row => row.AgentId == agentId)
            .Join(context.Fleet.Where(row => row.Id == fleetId), binding => binding.OwnerId, fleet => fleet.OwnerId, (binding, fleet) => new { binding, fleet })
            .Join(context.Principal, joined => joined.fleet.OwnerId, owner => owner.Id, (joined, owner) => new { joined.binding, joined.fleet, owner })
            .Join(context.FleetConnection, joined => joined.fleet.Id, connection => connection.FleetId, (joined, connection) => new { joined.binding, joined.fleet, joined.owner, connection })
            .Join(context.FleetCredential.Where(row => row.Id == credentialId), joined => joined.fleet.Id, credential => credential.FleetId, (joined, credential) =>
                new ControllerAdmissionFacts(joined.owner.Status, joined.binding.OwnerId, joined.binding.FleetKey, joined.binding.RetiredAt,
                    joined.fleet.Id, joined.fleet.OwnerId, joined.fleet.FleetKey, joined.fleet.ArchivedAt, joined.fleet.DeliveryEnabled == 1,
                    joined.connection.ConnectionId, joined.connection.CredentialId, joined.connection.ClosedAt, joined.connection.ExpiresAt, credential.FleetId, credential.RevokedAt)).SingleOrDefault());
        return !facts.IsSuccess ? Result<Unit>.Fail(facts.Error) : ControllerAdmission.Admits(found.Value, facts.Value, now)
            ? Results.Done() : Results.Fail<Unit>("conflict", "The original controller lease is no longer available");
    }
}
