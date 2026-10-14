using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record ControllerProof(string FleetId, string ConnectionId, string Credential);
public sealed record ListenerReport(string Release, long MessagesDelivered, bool Stopped, ControllerProof Controller);
public sealed record ListenerReportResult(bool Disconnect, string CurrentRelease, bool Closed);
public sealed record ListenerActivity(string Status, long ActiveMs, long MessagesDelivered, long? LastSeenAt, IReadOnlyList<ListenerRun> ActiveRuns);
public sealed record ListenerTotal(long ActiveMs, long MessagesDelivered, long? LastSeenAt);
public sealed record ListenerPorts(FleetPorts Fleet, Func<string, Result<ListenerRun?>> Find,
    Func<ListenerRun, bool, Result<Unit>> Save, Func<string, long, Result<IReadOnlyList<ListenerRun>>> Recent,
    Func<string, Result<ListenerTotal?>> Totals,
    Func<string, int, int, Result<Page<ListenerRun>>> History,
    Func<string, string, string, Result<ControllerAdmissionFacts?>> Facts);

public static class ListenerReporting
{
    public static Result<ListenerReportResult> Report(ListenerPorts ports, Actor actor, string agentId, string runId, ListenerReport input, string currentRelease)
    {
        if (runId.Length != 36 || runId.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9' or '-'))
            || input.Release.Length is < 1 or > 200 || input.MessagesDelivered is < 0 or > 9007199254740991)
            return Results.Fail<ListenerReportResult>("invalid", "Invalid listener report");
        return ports.Fleet.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Fleet.Authorization, actor, "listener.report.self");
            if (!authority.IsSuccess) return Result<ListenerReportResult>.Fail(authority.Error);
            if (actor.PrincipalId != agentId) return Results.Fail<ListenerReportResult>("missing", "Listener agent not found");
            var verified = FleetAuthority.Authenticate(ports.Fleet, input.Controller.Credential);
            if (!verified.IsSuccess) return Result<ListenerReportResult>.Fail(verified.Error);
            if (verified.Value.FleetId != input.Controller.FleetId) return Results.Fail<ListenerReportResult>("forbidden", "Controller authority belongs to another fleet");
            var fleet = ports.Fleet.Find(input.Controller.FleetId);
            if (!fleet.IsSuccess) return Result<ListenerReportResult>.Fail(fleet.Error);
            var binding = ports.Fleet.Authorization.Binding(agentId);
            if (!binding.IsSuccess) return Result<ListenerReportResult>.Fail(binding.Error);
            if (fleet.Value is null || fleet.Value.ArchivedAt is not null || binding.Value is null || binding.Value.RetiredAt is not null
                || binding.Value.OwnerId != fleet.Value.OwnerId || binding.Value.FleetKey != fleet.Value.FleetKey)
                return Results.Fail<ListenerReportResult>("forbidden", "Controller authority does not cover this agent");
            var controller = new ListenerController(input.Controller.FleetId, input.Controller.ConnectionId, verified.Value.CredentialId);
            var previous = ports.Find(runId);
            if (!previous.IsSuccess) return Result<ListenerReportResult>.Fail(previous.Error);
            if (previous.Value is not null && previous.Value.AgentId != agentId) return Results.Fail<ListenerReportResult>("missing", "Listener run not found");
            if (previous.Value?.StoppedAt is not null) return Result<ListenerReportResult>.Success(new(true, currentRelease, true));
            if (previous.Value is not null && previous.Value.Release != input.Release) return Results.Fail<ListenerReportResult>("conflict", "A running listener cannot change its software version");
            if (previous.Value is not null && previous.Value.Controller != controller) return Results.Fail<ListenerReportResult>("conflict", "A listener run cannot change its controller generation");
            if (previous.Value is null && input.Release != currentRelease)
                return Results.Fail<ListenerReportResult>("conflict", "Update the project-local Crossfire client and skill before reconnecting. Current release: " + currentRelease);
            var facts = ports.Facts(agentId, controller.FleetId, controller.CredentialId);
            if (!facts.IsSuccess) return Result<ListenerReportResult>.Fail(facts.Error);
            var now = ports.Fleet.Authorization.Now();
            var record = new ListenerRun(runId, agentId, input.Release, controller, previous.Value?.StartedAt ?? now, Math.Max(now, previous.Value?.LastSeenAt ?? now),
                previous.Value?.ActiveMs ?? 0, Math.Max(input.MessagesDelivered, previous.Value?.MessagesDelivered ?? 0), input.Stopped ? now : null, previous.Value?.DisconnectRequestedAt);
            var admitted = ControllerAdmission.Admits(record, facts.Value, now);
            if (previous.Value is null && !admitted) return Results.Fail<ListenerReportResult>("conflict", "An active authenticated controller lease and delivery intent are required");
            if (previous.Value is null)
            {
                var runs = ports.Recent(agentId, now - ControllerAdmission.HeartbeatExpiryMs);
                if (!runs.IsSuccess) return Result<ListenerReportResult>.Fail(runs.Error);
                var active = 0;
                foreach (var run in runs.Value.Where(value => value.StoppedAt is null && value.LastSeenAt + ControllerAdmission.HeartbeatExpiryMs > now))
                {
                    if (run.Controller is null) continue;
                    var runFacts = ports.Facts(agentId, run.Controller.FleetId, run.Controller.CredentialId);
                    if (!runFacts.IsSuccess) return Result<ListenerReportResult>.Fail(runFacts.Error);
                    if (ControllerAdmission.Admits(run, runFacts.Value, now)) active++;
                }
                if (active >= 100) return Results.Fail<ListenerReportResult>("limit", "Too many reporting listeners");
            }
            var elapsed = previous.Value is null ? 0 : Math.Max(0, now - previous.Value.LastSeenAt);
            var duration = checked(record.ActiveMs + (elapsed <= ControllerAdmission.HeartbeatExpiryMs ? elapsed : 0));
            if (duration > 9007199254740991) return Results.Fail<ListenerReportResult>("limit", "Listener active duration exceeds the exact integer range");
            record = record with { ActiveMs = duration, DisconnectRequestedAt = record.DisconnectRequestedAt ?? (admitted ? null : now) };
            return ports.Save(record, previous.Value is null).Map(_ => new ListenerReportResult(record.DisconnectRequestedAt is not null, currentRelease, false));
        });
    }

    public static Result<ListenerActivity> Activity(ListenerPorts ports, string agentId)
    {
        var runs = ports.Recent(agentId, ports.Fleet.Authorization.Now() - ControllerAdmission.HeartbeatExpiryMs);
        if (!runs.IsSuccess) return Result<ListenerActivity>.Fail(runs.Error);
        var now = ports.Fleet.Authorization.Now(); var active = new List<ListenerRun>();
        foreach (var run in runs.Value.Where(value => value.StoppedAt is null && value.LastSeenAt + ControllerAdmission.HeartbeatExpiryMs > now))
        {
            if (run.Controller is null) continue;
            var facts = ports.Facts(agentId, run.Controller.FleetId, run.Controller.CredentialId);
            if (!facts.IsSuccess) return Result<ListenerActivity>.Fail(facts.Error);
            if (ControllerAdmission.Admits(run, facts.Value, now)) active.Add(run);
        }
        var total = ports.Totals(agentId);
        return total.Map(value => Summarize(active, value));
    }

    public static ListenerActivity Summarize(IReadOnlyList<ListenerRun> active, ListenerTotal? total)
        => new(active.Any(run => run.DisconnectRequestedAt is null) ? "online" : active.Count != 0 ? "disconnecting" : "offline",
            total?.ActiveMs ?? 0, total?.MessagesDelivered ?? 0, total?.LastSeenAt, active);

    public static Result<Unit> Disconnect(ListenerPorts ports, Actor actor, string agentId, string? runId, string requestId)
        => ports.Fleet.Transaction.Run(() =>
        {
            var authority = Authorization.Agent(ports.Fleet.Authorization, actor, agentId, "configure");
            if (!authority.IsSuccess) return Result<Unit>.Fail(authority.Error);
            var activity = Activity(ports, agentId);
            if (!activity.IsSuccess) return Result<Unit>.Fail(activity.Error);
            foreach (var run in activity.Value.ActiveRuns.Where(value => runId is null || value.Id == runId))
            {
                var saved = ports.Save(run with { DisconnectRequestedAt = run.DisconnectRequestedAt ?? ports.Fleet.Authorization.Now() }, false);
                if (!saved.IsSuccess) return saved;
            }
            return ports.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, authority.Value.Agent.OwnerId, "agent", agentId, "listener.disconnect"));
        });
}
