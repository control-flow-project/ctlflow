using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record AgentListenerTotal(string AgentId, ListenerTotal Total);
public sealed record ListenerCandidate(ListenerRun Run, ControllerAdmissionFacts Facts);

public static class ListenerBatchQueries
{
    public static Result<IReadOnlyDictionary<string, ListenerActivity>> Activity(CrossfireDbContext context, IReadOnlyList<string> requested, long now)
    {
        var ids = requested.ToArray(); var since = now - ControllerAdmission.HeartbeatExpiryMs;
        var totals = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(row => ids.Contains(row.AgentId)).GroupBy(row => row.AgentId)
            .Select(group => new AgentListenerTotal(group.Key, new ListenerTotal(group.Sum(row => row.ActiveMs), group.Sum(row => row.MessagesDelivered), group.Max(row => row.LastSeenAt)))).ToArray());
        if (!totals.IsSuccess) return Result<IReadOnlyDictionary<string, ListenerActivity>>.Fail(totals.Error);
        var candidates = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(row => ids.Contains(row.AgentId) && row.StoppedAt == null && row.LastSeenAt > since)
            .Join(context.FleetInstance, run => run.AgentId, binding => binding.AgentId, (run, binding) => new { run, binding })
            .Join(context.Fleet, joined => joined.run.ControllerFleetId, fleet => fleet.Id, (joined, fleet) => new { joined.run, joined.binding, fleet })
            .Join(context.Principal, joined => joined.fleet.OwnerId, owner => owner.Id, (joined, owner) => new { joined.run, joined.binding, joined.fleet, owner })
            .Join(context.FleetConnection, joined => joined.fleet.Id, connection => connection.FleetId, (joined, connection) => new { joined.run, joined.binding, joined.fleet, joined.owner, connection })
            .Join(context.FleetCredential, joined => joined.run.ControllerCredentialId, credential => credential.Id, (joined, credential) => new { joined.run, joined.binding, joined.fleet, joined.owner, joined.connection, credential })
            .OrderBy(joined => joined.run.AgentId).ThenByDescending(joined => joined.run.LastSeenAt).ThenBy(joined => joined.run.Id)
            .Select(joined => new ListenerCandidate(new ListenerRun(joined.run.Id, joined.run.AgentId, joined.run.Release,
                joined.run.ControllerFleetId == null || joined.run.ControllerConnectionId == null || joined.run.ControllerCredentialId == null ? null : new ListenerController(joined.run.ControllerFleetId, joined.run.ControllerConnectionId, joined.run.ControllerCredentialId),
                joined.run.StartedAt, joined.run.LastSeenAt, joined.run.ActiveMs, joined.run.MessagesDelivered, joined.run.StoppedAt, joined.run.DisconnectRequestedAt),
                new ControllerAdmissionFacts(joined.owner.Status, joined.binding.OwnerId, joined.binding.FleetKey, joined.binding.RetiredAt, joined.fleet.Id, joined.fleet.OwnerId, joined.fleet.FleetKey, joined.fleet.ArchivedAt,
                    joined.fleet.DeliveryEnabled == 1, joined.connection.ConnectionId, joined.connection.CredentialId, joined.connection.ClosedAt, joined.connection.ExpiresAt, joined.credential.FleetId, joined.credential.RevokedAt))).ToArray());
        return candidates.Map<IReadOnlyDictionary<string, ListenerActivity>>(values =>
        {
            var byTotal = totals.Value.ToDictionary(value => value.AgentId, value => value.Total, StringComparer.Ordinal);
            var byAgent = values.Where(value => ControllerAdmission.Admits(value.Run, value.Facts, now, ControllerPurpose.Reporting)).ToLookup(value => value.Run.AgentId, value => value.Run, StringComparer.Ordinal);
            return ids.ToDictionary(id => id, id => ListenerReporting.Summarize(byAgent[id].ToArray(), byTotal.GetValueOrDefault(id)), StringComparer.Ordinal);
        });
    }
}
