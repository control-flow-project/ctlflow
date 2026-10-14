using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class AgentRoutingQueries
{
    public static Result<IReadOnlyList<ActiveIdentity>> Identities(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<ActiveIdentity>>(() =>
        {
            var humans = context.Principal.AsNoTracking().Where(row => row.Kind == "human" && row.Status == "active")
                .Select(row => new ActiveIdentity(new Principal(row.Id, row.MatrixUserId, row.Kind, row.Status, row.Revision, row.CreatedAt), row.Id)).ToArray();
            var agents = context.Agent.AsNoTracking().Join(context.Principal.Where(row => row.Status == "active"), agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
                .Join(context.Principal.Where(row => row.Status == "active"), joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal })
                .Join(context.FleetInstance.Where(row => row.RetiredAt == null), joined => joined.agent.PrincipalId, binding => binding.AgentId, (joined, binding) => new { joined.agent, joined.principal, binding })
                .Join(context.Fleet.Where(row => row.ArchivedAt == null), joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.binding, fleet })
                .Where(joined => joined.binding.FleetKey == joined.fleet.FleetKey)
                .Select(joined => new ActiveIdentity(new Principal(joined.principal.Id, joined.principal.MatrixUserId, joined.principal.Kind, joined.principal.Status, joined.principal.Revision, joined.principal.CreatedAt), joined.agent.OwnerId)).ToArray();
            return [.. humans, .. agents];
        });

    public static Result<IReadOnlyList<RoomGrantApplication>> Applications(CrossfireDbContext context, string agentId)
        => Stored.Read<IReadOnlyList<RoomGrantApplication>>(() => context.RoomGrantApplication.AsNoTracking().Where(row => row.AgentId == agentId).OrderBy(row => row.RoomId)
            .Select(row => new RoomGrantApplication(row.AgentId, row.RoomId, row.ObservedGeneration, row.AppliedRevision, row.AppliedAccessRevision, row.Membership,
                row.Creator == 1, row.PowerLevel, row.LastAttemptAt, row.LastSuccessAt, row.NextCheckAt, row.ErrorCode, row.ErrorMessage)).ToArray());

    public static AgentRoutingPorts Ports(CrossfireDbContext context, Func<long> now, Func<string, string, CancellationToken, ValueTask<Result<RoomFacts>>> room)
        => new(RoomGrantCommands.Ports(context, now, room), DiscoveryQueries.Ports(context, now), () => PolicyQueries.Find(context), () => Identities(context),
            id => WakeCommands.Senders(context, id), id => Applications(context, id));
}
