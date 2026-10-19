using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class EnrollmentAdmissionQueries
{
    public static Result<FleetRecord?> Fleet(CrossfireDbContext context, string ownerId, string fleetKey)
        => Stored.Read(() => context.Fleet.AsNoTracking().Where(row => row.OwnerId == ownerId && row.FleetKey == fleetKey)
            .Select(row => new FleetRecord(row.Id, row.OwnerId, row.FleetKey, row.Label, row.ControllerName, row.Revision,
                row.CreatedAt, row.UpdatedAt, row.DeliveryEnabled == 1, row.ArchivedAt)).SingleOrDefault());

    public static Result<FleetBinding?> Binding(CrossfireDbContext context, string ownerId, string fleetKey, string instanceKey)
        => Stored.Read(() => context.FleetInstance.AsNoTracking().Where(row => row.OwnerId == ownerId && row.FleetKey == fleetKey && row.InstanceKey == instanceKey)
            .Select(row => new FleetBinding(row.OwnerId, row.FleetKey, row.InstanceKey, row.AgentId, row.RetiredAt)).SingleOrDefault());

    public static Result<AgentName?> Name(CrossfireDbContext context, string name)
        => Stored.Read(() => context.AgentName.AsNoTracking().Where(row => row.Name == name)
            .Select(row => new AgentName(row.Name, row.RequestId, row.InstanceKey, row.AgentId)).SingleOrDefault());

    public static Result<string?> Token(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.AgentCredential.AsNoTracking().Where(row => row.AgentId == agentId).Select(row => row.AccessToken).SingleOrDefault());

    public static Result<long> ActiveAgents(CrossfireDbContext context, string? ownerId)
        => Stored.Read(() => context.Agent.AsNoTracking()
            .Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
            .Join(context.FleetInstance, joined => joined.agent.PrincipalId, instance => instance.AgentId, (joined, instance) => new { joined.agent, joined.principal, instance })
            .Join(context.Fleet, joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.instance, fleet })
            .LongCount(joined => joined.principal.Status != "revoked" && joined.instance.RetiredAt == null && joined.fleet.ArchivedAt == null
                && joined.instance.OwnerId == joined.fleet.OwnerId && joined.instance.FleetKey == joined.fleet.FleetKey && (ownerId == null || joined.agent.OwnerId == ownerId)));

    public static Result<long> PendingIdentities(CrossfireDbContext context, string? ownerId)
        => Stored.Read(() => context.EnrollmentRequest.AsNoTracking()
            .Join(context.EnrollmentItem, request => request.Id, item => item.RequestId, (request, item) => new { request, item })
            .LongCount(joined => joined.request.Status == "pending" && joined.item.Outcome == "claimed" && joined.item.AgentId == null
                && (ownerId == null || joined.request.OwnerId == ownerId)));

    public static EnrollmentAdmissionPorts Ports(CrossfireDbContext context, Func<long> now,
        Func<string, CancellationToken, ValueTask<Result<string>>> identify)
        => new(FleetCommands.Ports(context, now), id => MemberQueries.ByBackendUserId(context, id), id => MemberQueries.Find(context, id),
            (owner, key) => Fleet(context, owner, key), (owner, key, instance) => Binding(context, owner, key, instance),
            name => Name(context, name), id => Token(context, id), () => PolicyQueries.Find(context),
            owner => ActiveAgents(context, owner), owner => PendingIdentities(context, owner), identify);
}
