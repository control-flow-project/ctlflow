using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record RuntimeSetting(string Name, string? Configured, string? Effective);
public sealed record RuntimeObservation(string RunId, string SessionId, string? RoomId, string Runtime, string State, long ObservedAt,
    long? LastActivityAt, bool? HistoryAvailable, string HistoryMode, long MaxInputBytes, IReadOnlyList<RuntimeSetting> Settings, string? ErrorMessage);
public sealed record RuntimeSummary(string State, long ObservedAt, long? LastActivityAt, bool? HistoryAvailable);
public sealed record RuntimeStateObservation(string State, long ObservedAt, long? LastActivityAt, bool? HistoryAvailable);
public sealed record RuntimePorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, string, Result<Unit>> LiveRun, Func<string, Result<IReadOnlyList<RuntimeObservation>>> Observations,
    Func<string, RuntimeObservation, Result<Unit>> Save, Func<string, long, Result<Unit>> InvalidateStop, IncidentPorts Incidents);

public static class RuntimeObservations
{
    private static readonly string[] Settings = ["model", "model_reasoning_effort", "sandbox_mode", "approval_policy", "native_version",
        "dangerously_bypass_approvals_and_sandbox", "features.default_mode_request_user_input", "provider", "thinking_level"];
    private static readonly string[] States = ["failed", "waiting-approval", "waiting-answer", "waking", "working", "unavailable", "idle", "sleeping"];

    public static RuntimeSummary? Summarize(IReadOnlyList<RuntimeObservation> values)
        => Summarize(values.Select(value => new RuntimeStateObservation(value.State, value.ObservedAt, value.LastActivityAt, value.HistoryAvailable)).ToArray());

    public static RuntimeSummary? Summarize(IReadOnlyList<RuntimeStateObservation> values)
    {
        if (values.Count == 0) return null;
        var activity = values.Where(value => value.LastActivityAt is not null).Select(value => value.LastActivityAt!.Value).ToArray();
        return new(States.First(state => values.Any(value => value.State == state)), values.Max(value => value.ObservedAt), activity.Length == 0 ? null : activity.Max(),
            values.Any(value => value.HistoryAvailable == false) ? false : values.All(value => value.HistoryAvailable == true) ? true : null);
    }

    public static RuntimeSummary? WithStop(RuntimeSummary? summary, long? stoppedAt)
        => stoppedAt is null ? summary : new("stopped", stoppedAt.Value, summary?.LastActivityAt, summary?.HistoryAvailable);

    public static Result<IReadOnlyList<RuntimeObservation>> Read(RuntimePorts ports, Actor actor, string agentId)
    {
        var authority = Authorization.Agent(ports.Authorization, actor, agentId, "read");
        return authority.IsSuccess ? ports.Observations(agentId) : Result<IReadOnlyList<RuntimeObservation>>.Fail(authority.Error);
    }

    public static Result<Unit> Report(RuntimePorts ports, Actor actor, string agentId, RuntimeObservation input)
    {
        if (input.Runtime is not ("codex" or "pi") || !States.Contains(input.State, StringComparer.Ordinal)
            || input.HistoryMode is not ("shared" or "per-room") || input.MaxInputBytes is < 1 or > 4194304 || input.ObservedAt < 0 || input.LastActivityAt < 0)
            return Results.Fail<Unit>("invalid", "Invalid native runtime observation");
        return ports.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Authorization, actor, "runtime.report.self");
            if (!authority.IsSuccess) return Result<Unit>.Fail(authority.Error);
            if (actor.PrincipalId != agentId) return Results.Fail<Unit>("missing", "Agent not found");
            var live = ports.LiveRun(agentId, input.RunId);
            if (!live.IsSuccess) return live;
            if (input.ObservedAt > ports.Authorization.Now() + 60000 || input.Settings.Select(value => value.Name).Distinct(StringComparer.Ordinal).Count() != input.Settings.Count
                || input.Settings.Any(value => !Settings.Contains(value.Name, StringComparer.Ordinal))) return Results.Fail<Unit>("invalid", "Only public runtime settings may be reported");
            if (input.LastActivityAt > ports.Authorization.Now() + 60000) return Results.Fail<Unit>("invalid", "Native activity cannot be reported in the future");
            var previous = ports.Observations(agentId);
            if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error);
            var original = previous.Value.FirstOrDefault(value => value.RunId == input.RunId && value.SessionId == input.SessionId);
            if (original is not null && (original.RoomId != input.RoomId || original.HistoryMode != input.HistoryMode || original.Runtime != input.Runtime))
                return Results.Fail<Unit>("conflict", "Native history scope or listener configuration changed within the run");
            if (original is null && previous.Value.Count >= 2002) return Results.Fail<Unit>("limit", "Too many native histories in this listener run");
            if (original is not null && original.ObservedAt > input.ObservedAt) return Results.Fail<Unit>("conflict", "Runtime observation is older than the recorded state");
            var saved = ports.Save(agentId, input);
            if (!saved.IsSuccess) return saved;
            if (input.State is not ("unavailable" or "sleeping"))
            {
                var invalidated = ports.InvalidateStop(agentId, ports.Authorization.Now());
                if (!invalidated.IsSuccess) return invalidated;
            }
            if (input.State == "failed")
            {
                var agent = ports.Authorization.AgentView(agentId);
                if (!agent.IsSuccess) return Result<Unit>.Fail(agent.Error);
                if (agent.Value is null) return Results.Fail<Unit>("missing", "Agent not found");
                return RuntimeIncidents.Open(ports.Incidents, new(Identity.Identifier(), agent.Value.Agent.OwnerId, agentId, null, input.RunId, input.SessionId, "failure",
                    agent.Value.Name + " (" + agent.Value.OwnerMember.DisplayName + ") failed: " + (input.ErrorMessage ?? "Native execution failed. Inspect the original session before resuming."),
                    ports.Authorization.Now(), null));
            }
            return input.State is "idle" or "working" or "waiting-approval" or "waiting-answer"
                ? RuntimeIncidents.Recover(ports.Incidents, agentId, null, input.SessionId) : Results.Done();
        });
    }
}
