using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record RetirementMember(string AgentId, string FleetId, bool OwnerActive);
public sealed record RuntimeActivityTime(string AgentId, long At);

public static class RetirementQueries
{
    public static Result<NativeStop?> Stop(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.FleetNativeStop.AsNoTracking().Where(row => row.AgentId == agentId).OrderByDescending(row => row.Sequence)
            .Select(row => new NativeStop(row.AgentId, row.ReceiptId, row.Sequence, row.FleetId, row.RunId, row.ConnectionId, row.CredentialId, row.NativeStoppedAt, row.InvalidatedAt)).FirstOrDefault());

    public static Result<NativeStop?> Receipt(CrossfireDbContext context, string agentId, string receiptId)
        => Stored.Read(() => context.FleetNativeStop.AsNoTracking().Where(row => row.AgentId == agentId && row.ReceiptId == receiptId)
            .Select(row => new NativeStop(row.AgentId, row.ReceiptId, row.Sequence, row.FleetId, row.RunId, row.ConnectionId, row.CredentialId, row.NativeStoppedAt, row.InvalidatedAt)).SingleOrDefault());

    public static Result<RetirementSnapshot> Snapshot(CrossfireDbContext context, IReadOnlyList<string> selectedAgents, IReadOnlyList<string> selectedFleets, long now)
    {
        var requestedAgents = selectedAgents.ToArray(); var requestedFleets = selectedFleets.ToArray();
        var membership = Stored.Read(() => context.FleetInstance.AsNoTracking().Where(row => row.RetiredAt == null)
                .Join(context.Fleet.Where(row => row.ArchivedAt == null), instance => instance.OwnerId, fleet => fleet.OwnerId, (instance, fleet) => new { instance, fleet })
                .Join(context.Principal, joined => joined.instance.OwnerId, owner => owner.Id, (joined, owner) => new { joined.instance, joined.fleet, owner })
                .Where(joined => joined.instance.FleetKey == joined.fleet.FleetKey && (requestedAgents.Contains(joined.instance.AgentId) || requestedFleets.Contains(joined.fleet.Id)))
                .Select(joined => new RetirementMember(joined.instance.AgentId, joined.fleet.Id, joined.owner.Status == "active")).ToArray());
        if (!membership.IsSuccess) return Result<RetirementSnapshot>.Fail(membership.Error);
        var members = membership.Value; var agentIds = members.Select(member => member.AgentId).ToArray();
        var latest = ListenerQueries.Latest(context, agentIds);
        if (!latest.IsSuccess) return Result<RetirementSnapshot>.Fail(latest.Error);
        return Stored.Read(() =>
        {
            var fleetIds = members.Select(member => member.FleetId).Concat(requestedFleets).Distinct(StringComparer.Ordinal).ToArray();
            var pending = context.FleetRuntimeOperation.AsNoTracking().Where(row => fleetIds.Contains(row.FleetId) && (row.Status == "pending" || row.Status == "running"))
                .Select(row => row.FleetId).Distinct().ToArray();
            var runs = latest.Value;
            var proofs = context.FleetNativeStop.AsNoTracking().Where(row => agentIds.Contains(row.AgentId)
                && !context.FleetNativeStop.Any(other => other.AgentId == row.AgentId && other.Sequence > row.Sequence))
                .Select(row => new NativeStop(row.AgentId, row.ReceiptId, row.Sequence, row.FleetId, row.RunId, row.ConnectionId, row.CredentialId, row.NativeStoppedAt, row.InvalidatedAt)).ToArray();
            var observed = context.RuntimeObservation.AsNoTracking().Where(row => agentIds.Contains(row.AgentId)).Select(row => row.AgentId).Distinct().ToArray();
            var runIds = runs.Select(run => run.Id).ToArray();
            var activity = context.RuntimeObservation.AsNoTracking().Where(row => runIds.Contains(row.RunId) && row.State != "sleeping" && row.State != "unavailable")
                .GroupBy(row => row.AgentId).Select(group => new RuntimeActivityTime(group.Key, group.Max(row => row.ObservedAt))).ToArray();
            var decisions = context.RuntimeDecision.AsNoTracking().Where(row => agentIds.Contains(row.AgentId) && (row.Status == "pending" || row.Status == "answered"))
                .Select(row => row.AgentId).Distinct().ToArray();
            var wakes = context.WakeDelivery.AsNoTracking().Where(row => agentIds.Contains(row.AgentId) && row.Status == "pending").Select(row => row.AgentId).Distinct().ToArray();
            var broadcasts = context.FleetMessageDelivery.AsNoTracking().Where(row => agentIds.Contains(row.AgentId) && row.Status == "pending")
                .Join(context.FleetMessage.Where(row => row.ExpiresAt > now), delivery => delivery.MessageId, message => message.Id, (delivery, message) => delivery.AgentId).Distinct().ToArray();
            var controllers = context.FleetConnection.AsNoTracking().Where(row => fleetIds.Contains(row.FleetId))
                .Select(row => new FleetConnection(row.FleetId, row.ConnectionId, row.CredentialId, row.LastSeenAt, row.ExpiresAt, row.ClosedAt)).ToArray();
            var credentialIds = controllers.Select(row => row.CredentialId).ToArray();
            var credentials = context.FleetCredential.AsNoTracking().Where(row => credentialIds.Contains(row.Id))
                .Select(row => new FleetCredential(row.Id, row.FleetId, row.SecretHash, row.CreatedAt, row.RevokedAt)).ToArray();
            var byRun = runs.ToDictionary(row => row.AgentId, StringComparer.Ordinal); var byProof = proofs.ToDictionary(row => row.AgentId, StringComparer.Ordinal);
            var byActivity = activity.ToDictionary(row => row.AgentId, StringComparer.Ordinal); var byController = controllers.ToDictionary(row => row.FleetId, StringComparer.Ordinal);
            var byCredential = credentials.ToDictionary(row => row.Id, StringComparer.Ordinal);
            var pendingSet = pending.ToHashSet(StringComparer.Ordinal); var decisionSet = decisions.ToHashSet(StringComparer.Ordinal);
            var wakeSet = wakes.ToHashSet(StringComparer.Ordinal); var broadcastSet = broadcasts.ToHashSet(StringComparer.Ordinal); var observedSet = observed.ToHashSet(StringComparer.Ordinal);
            return new RetirementSnapshot(members.Select(member =>
            {
                var controller = byController.GetValueOrDefault(member.FleetId);
                return new RetirementAgent(member.AgentId, member.FleetId, member.OwnerActive, pendingSet.Contains(member.FleetId), decisionSet.Contains(member.AgentId),
                    wakeSet.Contains(member.AgentId), broadcastSet.Contains(member.AgentId), observedSet.Contains(member.AgentId), byRun.GetValueOrDefault(member.AgentId),
                    byActivity.GetValueOrDefault(member.AgentId)?.At, byProof.GetValueOrDefault(member.AgentId), controller,
                    controller is null ? null : byCredential.GetValueOrDefault(controller.CredentialId));
            }).ToArray(), pending);
        });
    }
}
