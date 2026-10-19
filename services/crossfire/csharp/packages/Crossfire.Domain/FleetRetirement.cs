using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record NativeStop(string AgentId, string ReceiptId, long Sequence, string FleetId, string RunId, string ConnectionId,
    string CredentialId, long NativeStoppedAt, long? InvalidatedAt);
public sealed record RetirementAgent(string AgentId, string FleetId, bool OwnerActive, bool PendingOperation, bool PendingDecision, bool PendingWake, bool PendingBroadcast,
    bool HasObservedRuntime, ListenerRun? LatestRun, long? LatestActiveObservationAt, NativeStop? NativeStop, FleetConnection? Controller, FleetCredential? Credential);
public sealed record RetirementSnapshot(IReadOnlyList<RetirementAgent> Agents, IReadOnlyList<string> PendingFleetIds);
public sealed record RetirementPorts(FleetPorts Fleet, ListenerPorts Listener,
    Func<IReadOnlyList<string>, IReadOnlyList<string>, long, Result<RetirementSnapshot>> Snapshot,
    Func<string, Result<NativeStop?>> LatestStop, Func<string, string, Result<NativeStop?>> Receipt,
    Func<NativeStop, Result<Unit>> SaveStop, Func<FleetBinding, Result<Unit>> Retire,
    Func<string, Result<IReadOnlyList<FleetCredential>>> Credentials, Func<FleetCredential, Result<Unit>> SaveCredential);

public static class FleetRetirement
{
    public static bool Settled(RetirementAgent agent) => !agent.PendingDecision && !agent.PendingWake && !agent.PendingBroadcast;

    public static bool Eligible(RetirementAgent agent, long now)
    {
        if (agent.PendingOperation || !Settled(agent)) return false;
        if (!agent.HasObservedRuntime && agent.LatestRun is null) return true;
        var run = agent.LatestRun; var proof = agent.NativeStop; var controller = agent.Controller; var credential = agent.Credential;
        return agent.OwnerActive && run is { StoppedAt: not null, Controller: not null } && proof is { InvalidatedAt: null }
            && proof.AgentId == agent.AgentId && proof.FleetId == agent.FleetId && proof.RunId == run.Id && run.Controller.FleetId == agent.FleetId
            && run.Controller.ConnectionId == proof.ConnectionId && run.Controller.CredentialId == proof.CredentialId
            && controller is { ClosedAt: null } && controller.ExpiresAt > now && controller.FleetId == agent.FleetId
            && controller.ConnectionId == proof.ConnectionId && controller.CredentialId == proof.CredentialId
            && credential is { RevokedAt: null } && credential.Id == proof.CredentialId && credential.FleetId == agent.FleetId
            && (agent.LatestActiveObservationAt is null || agent.LatestActiveObservationAt <= proof.NativeStoppedAt);
    }

    public static Result<Unit> RecordStop(RetirementPorts ports, FleetActor actor, string fleetId, string agentId, string connectionId, string runId, string receiptId)
        => ports.Fleet.Transaction.Run(() =>
        {
            var current = FleetAuthority.Live(ports.Fleet, actor, fleetId, connectionId);
            if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            var binding = ports.Fleet.Authorization.Binding(agentId);
            if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
            if (binding.Value is null || binding.Value.RetiredAt is not null || binding.Value.OwnerId != current.Value.Fleet.OwnerId || binding.Value.FleetKey != current.Value.Fleet.FleetKey)
                return Results.Fail<Unit>("forbidden", "Native stop proof must cover this current fleet instance");
            var run = ports.Listener.Find(runId);
            if (!run.IsSuccess) return Result<Unit>.Fail(run.Error);
            if (run.Value is null || run.Value.AgentId != agentId || run.Value.Controller.FleetId != fleetId || run.Value.Controller.ConnectionId != connectionId
                || run.Value.Controller.CredentialId != current.Value.Connection.CredentialId)
                return Results.Fail<Unit>("conflict", "Native stop proof requires the current authenticated listener generation");
            if (run.Value.StoppedAt is null) return Results.Fail<Unit>("conflict", "Stop delivery for this listener generation before recording native close");
            var runs = ports.Listener.History(agentId, 1, 1);
            if (!runs.IsSuccess) return Result<Unit>.Fail(runs.Error);
            if (runs.Value.Items.FirstOrDefault()?.Id != runId) return Results.Fail<Unit>("conflict", "Native stop proof must cover the latest listener run");
            var existing = ports.Receipt(agentId, receiptId);
            if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
            if (existing.Value is not null) return existing.Value.RunId == runId && existing.Value.ConnectionId == connectionId
                && existing.Value.CredentialId == current.Value.Connection.CredentialId && existing.Value.InvalidatedAt is null
                ? Results.Done() : Results.Fail<Unit>("conflict", "This native stop receipt is obsolete or belongs to another generation");
            var snapshot = ports.Snapshot([agentId], [], ports.Fleet.Authorization.Now());
            if (!snapshot.IsSuccess) return Result<Unit>.Fail(snapshot.Error);
            if (snapshot.Value.Agents.SingleOrDefault() is not { } agent || !Settled(agent))
                return Results.Fail<Unit>("conflict", "Settle native decisions and wake receipts before reporting a native stop");
            var previous = ports.LatestStop(agentId);
            if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error);
            return ports.SaveStop(new(agentId, receiptId, checked((previous.Value?.Sequence ?? 0) + 1), fleetId, runId, connectionId,
                current.Value.Connection.CredentialId, ports.Fleet.Authorization.Now(), null));
        });

    private static Result<FleetRecord> Authority(RetirementPorts ports, FleetActor actor, string fleetId, long revision)
    {
        var fleet = FleetAuthority.Find(ports.Fleet, actor, fleetId, true);
        if (!fleet.IsSuccess) return fleet;
        if (actor is FleetControllerActor)
        {
            var connection = ports.Fleet.Connection(fleetId);
            if (!connection.IsSuccess) return Result<FleetRecord>.Fail(connection.Error);
            if (connection.Value is null) return Results.Fail<FleetRecord>("conflict", "An authenticated current controller lease is required to retire");
            var live = FleetAuthority.Live(ports.Fleet, actor, fleetId, connection.Value.ConnectionId);
            if (!live.IsSuccess) return Result<FleetRecord>.Fail(live.Error);
        }
        return fleet.Value.Revision != revision ? Results.Fail<FleetRecord>("stale_revision", "Refresh the fleet before retiring an instance or archiving") : fleet;
    }

    public static Result<Unit> Remove(RetirementPorts ports, FleetActor actor, string fleetId, string agentId, string instanceKey, long expectedRevision, string requestId)
        => ports.Fleet.Transaction.Run(() =>
        {
            var fleet = Authority(ports, actor, fleetId, expectedRevision);
            if (!fleet.IsSuccess) return Result<Unit>.Fail(fleet.Error);
            var binding = ports.Fleet.Authorization.Binding(agentId);
            if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
            if (binding.Value is null || binding.Value.OwnerId != fleet.Value.OwnerId || binding.Value.FleetKey != fleet.Value.FleetKey || binding.Value.InstanceKey != instanceKey)
                return Results.Fail<Unit>("conflict", "Instance membership does not match");
            if (binding.Value.RetiredAt is null)
            {
                var snapshot = ports.Snapshot([agentId], [], ports.Fleet.Authorization.Now());
                if (!snapshot.IsSuccess) return Result<Unit>.Fail(snapshot.Error);
                if (snapshot.Value.Agents.SingleOrDefault() is not { } agent || agent.FleetId != fleetId || !Eligible(agent, ports.Fleet.Authorization.Now()))
                    return Results.Fail<Unit>("conflict", "Stop the native session through its controller and settle all pending receipts before retirement");
            }
            var retired = ports.Retire(binding.Value);
            if (!retired.IsSuccess) return retired;
            var changed = ports.Fleet.Save(fleet.Value with { Revision = checked(fleet.Value.Revision + 1), UpdatedAt = ports.Fleet.Authorization.Now() });
            if (!changed.IsSuccess) return changed;
            return ports.Fleet.Audit(FleetValues.Audit(actor, requestId, fleet.Value, "fleet.agent.retire", fleetId + "/" + instanceKey) with { TargetKind = "agent", TargetId = agentId });
        });

    public static Result<Unit> Archive(RetirementPorts ports, FleetActor actor, string fleetId, long expectedRevision, string requestId)
        => ports.Fleet.Transaction.Run(() =>
        {
            var fleet = Authority(ports, actor, fleetId, expectedRevision);
            if (!fleet.IsSuccess) return Result<Unit>.Fail(fleet.Error);
            var instances = ports.Fleet.Bindings(fleet.Value);
            if (!instances.IsSuccess) return Result<Unit>.Fail(instances.Error);
            var snapshot = ports.Snapshot([], [fleetId], ports.Fleet.Authorization.Now());
            if (!snapshot.IsSuccess) return Result<Unit>.Fail(snapshot.Error);
            if (snapshot.Value.PendingFleetIds.Contains(fleetId, StringComparer.Ordinal)) return Results.Fail<Unit>("conflict", "Finish the pending session operation before archiving");
            foreach (var instance in instances.Value)
            {
                var current = snapshot.Value.Agents.FirstOrDefault(value => value.AgentId == instance.AgentId);
                if (current is null || current.FleetId != fleetId || !Eligible(current, ports.Fleet.Authorization.Now()))
                    return Results.Fail<Unit>("conflict", "Stop the native sessions through their controller and settle all pending receipts before archiving");
            }
            foreach (var instance in instances.Value)
            {
                var retired = ports.Retire(instance);
                if (!retired.IsSuccess) return retired;
            }
            var credentials = ports.Credentials(fleetId);
            if (!credentials.IsSuccess) return Result<Unit>.Fail(credentials.Error);
            var now = ports.Fleet.Authorization.Now();
            foreach (var credential in credentials.Value.Where(value => value.RevokedAt is null))
            {
                var revoked = ports.SaveCredential(credential with { RevokedAt = now });
                if (!revoked.IsSuccess) return revoked;
            }
            var connection = ports.Fleet.Connection(fleetId);
            if (!connection.IsSuccess) return Result<Unit>.Fail(connection.Error);
            if (connection.Value is { ClosedAt: null })
            {
                var closed = ports.Fleet.SaveConnection(connection.Value with { ClosedAt = now });
                if (!closed.IsSuccess) return closed;
            }
            var changed = ports.Fleet.Save(fleet.Value with { ArchivedAt = now, DeliveryEnabled = false, Revision = checked(fleet.Value.Revision + 1), UpdatedAt = now });
            return changed.IsSuccess ? ports.Fleet.Audit(FleetValues.Audit(actor, requestId, fleet.Value, "fleet.archive")) : changed;
        });
}
