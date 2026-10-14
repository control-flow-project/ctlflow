using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record WatchedRun(string Id, string AgentId, long StartedAt, long LastSeenAt, long? StoppedAt, long? DisconnectRequestedAt);
public sealed record WatchedFleet(string Id, string OwnerId, string Label, long ExpiresAt, long? ClosedAt);
public sealed record ContactPorts(IncidentPorts Incidents, Func<Result<IReadOnlyList<WatchedRun>>> Runs, Func<Result<IReadOnlyList<WatchedFleet>>> Fleets);

public static class RuntimeContact
{
    public static Result<Unit> Observe(ContactPorts ports)
        => ports.Incidents.Transaction.Run(() =>
        {
            var runs = ports.Runs(); if (!runs.IsSuccess) return Result<Unit>.Fail(runs.Error);
            var fleets = ports.Fleets(); if (!fleets.IsSuccess) return Result<Unit>.Fail(fleets.Error);
            var now = ports.Incidents.Authorization.Now();
            foreach (var run in runs.Value)
            {
                if (run.StoppedAt is not null || run.DisconnectRequestedAt is not null) continue;
                if (run.LastSeenAt + ControllerAdmission.HeartbeatExpiryMs > now)
                { var restored = RuntimeIncidents.Recover(ports.Incidents, run.AgentId, null, kind: "contact"); if (!restored.IsSuccess) return restored; continue; }
                var agent = ports.Incidents.Authorization.AgentView(run.AgentId); if (!agent.IsSuccess) return Result<Unit>.Fail(agent.Error);
                if (agent.Value is null || agent.Value.Principal.Status != "active" || agent.Value.Owner.Status != "active") continue;
                var opened = RuntimeIncidents.Open(ports.Incidents, new(Identity.Identifier(), agent.Value.Owner.Id, run.AgentId, null, run.Id, null, "contact",
                    agent.Value.Name + " (" + agent.Value.OwnerMember.DisplayName + "): listener contact lost. Execution state is unknown; this is not proof of a crash.", now, null));
                if (!opened.IsSuccess) return opened;
            }
            foreach (var fleet in fleets.Value)
            {
                if (fleet.ClosedAt is null && fleet.ExpiresAt > now)
                { var restored = RuntimeIncidents.Recover(ports.Incidents, null, fleet.Id); if (!restored.IsSuccess) return restored; }
                if (fleet.ClosedAt is not null || fleet.ExpiresAt > now) continue;
                var opened = RuntimeIncidents.Open(ports.Incidents, new(Identity.Identifier(), fleet.OwnerId, null, fleet.Id, null, null, "contact", fleet.Label + ": controller contact lost. Bound listeners deactivate; native execution state is unknown.", now, null));
                if (!opened.IsSuccess) return opened;
            }
            return Results.Done();
        });
}
