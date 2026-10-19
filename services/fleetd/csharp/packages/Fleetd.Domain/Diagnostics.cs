using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed record DiagnosticScope(string? FleetId, string? InstanceKey);
public sealed record DiagnosticCheck(string Id, DiagnosticScope Scope, string Status, long? ObservedAt, string Message, string? Remediation);
public sealed record DiagnosticReport(long CheckedAt, DiagnosticScope Scope, IReadOnlyList<DiagnosticCheck> Checks);

public sealed partial class FleetController
{
    public async ValueTask<Result<DiagnosticReport>> Diagnostics(DiagnosticScope scope, CancellationToken cancellation)
    {
        if (scope.InstanceKey is not null && scope.FleetId is null) return Results.Fail<DiagnosticReport>("invalid", "An instance requires a fleet");
        lock (gate) if (scope.FleetId is not null && !records.Any(record => record.FleetId == scope.FleetId)) return Results.Fail<DiagnosticReport>("missing", "Fleet is not registered");
        var checkedAt = Now; List<DiagnosticCheck> checks = [];
        void Add(string id, DiagnosticScope target, string status, string message, string? remediation = null, long? observedAt = null, bool unobserved = false)
            => checks.Add(new(id, target, status, unobserved ? null : observedAt ?? checkedAt, message, remediation));
        DiagnosticScope controllerScope = new(null, null);
        Add("controller.connection", controllerScope, "pass", "Authenticated controller API is reachable");
        var isStopping = Stopping;
        Add("controller.lifecycle", controllerScope, isStopping ? "fail" : "pass", isStopping ? "Controller is stopping" : "Controller is running", isStopping ? "Start the controller after shutdown completes" : null);
        if (scope.FleetId is null) return Result<DiagnosticReport>.Success(new(checkedAt, scope, checks));
        DiagnosticScope fleetScope = new(scope.FleetId, null); var fleet = View(scope.FleetId);
        if (!fleet.IsSuccess)
        {
            Add("fleet.configuration", fleetScope, "fail", "Registered fleet configuration cannot be loaded", "Correct the registered directory and fleet configuration");
            Add("fleet.connection", fleetScope, "unknown", "Fleet connection cannot be evaluated without its configuration", unobserved: true);
            return Result<DiagnosticReport>.Success(new(checkedAt, scope, checks));
        }
        var instances = fleet.Value.Instances.Where(item => scope.InstanceKey is null || item.Instance.Key == scope.InstanceKey).ToArray();
        if (scope.InstanceKey is not null && instances.Length == 0) return Results.Fail<DiagnosticReport>("missing", "Instance not found");
        Add("fleet.configuration", fleetScope, "pass", "Registered fleet configuration is readable");
        var connected = fleet.Value.Connection.Connected;
        Add("fleet.connection", fleetScope, connected ? "pass" : "fail", connected ? "Controller reports an active crossfire connection" : "Controller has no active crossfire connection", connected ? null : "Check crossfire availability, enrollment and controller logs");
        Add("fleet.delivery", fleetScope, connected ? "pass" : "unknown", connected ? fleet.Value.Connection.DeliveryEnabled ? "Message delivery is enabled" : "Message delivery is deliberately paused" : "Delivery intent has not been confirmed by crossfire", unobserved: !connected);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(TimeSpan.FromSeconds(20));
        using var probes = new SemaphoreSlim(4, 4);
        var observations = await Task.WhenAll(instances.Select(async instance =>
        {
            RunningAgent? runtime; lock (gate) runtime = running.GetValueOrDefault((scope.FleetId, instance.Instance.Key));
            if (runtime is null || runtime.Lifetime.IsCancellationRequested || deadline.IsCancellationRequested) return (NativeDiagnostic?)null;
            var acquired = false;
            try
            {
                await probes.WaitAsync(deadline.Token); acquired = true;
                using var probe = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token); probe.CancelAfter(TimeSpan.FromSeconds(5));
                var native = await runtime.Diagnostics(probe.Token);
                lock (gate) return ReferenceEquals(running.GetValueOrDefault((scope.FleetId, instance.Instance.Key)), runtime) && !runtime.Lifetime.IsCancellationRequested ? native : null;
            }
            catch (Exception error) when (error is OperationCanceledException or IOException or InvalidOperationException) { return null; }
            finally { if (acquired) probes.Release(); }
        }));
        for (var index = 0; index < instances.Length; index++)
        {
            var instance = instances[index]; var native = observations[index]; DiagnosticScope target = new(scope.FleetId, instance.Instance.Key);
            Add("agent.activation", target, "pass", instance.DesiredActive ? "Agent is selected for activation" : "Agent is not selected for activation");
            bool live; lock (gate) live = running.GetValueOrDefault((scope.FleetId, instance.Instance.Key)) is { } owner && !owner.Lifetime.IsCancellationRequested;
            checks.Add(ListenerFinding(instance, fleet.Value.Connection, live, target, checkedAt));
            Add("agent.history", target, instance.HistoryAvailable is null ? "unknown" : instance.HistoryAvailable.Value ? "pass" : "fail", instance.HistoryAvailable is null ? "No saved-history observation is available" : instance.HistoryAvailable.Value ? "Controller previously observed a retained history binding; files were not revalidated" : "No retained history binding was observed", instance.HistoryAvailable == false ? "Inspect retained contexts before choosing an explicit fresh-history operation" : null, instance.LastActivityAt, instance.LastActivityAt is null);
            var state = native?.State ?? (instance.Phase is "stopped" or "failed" ? instance.Phase : "unknown");
            Add("agent.native", target, state is "failed" or "unavailable" ? "fail" : state == "unknown" ? "unknown" : "pass", "Native state: " + state, state == "failed" ? "Inspect the native failure and retained history before resuming" : null, native?.ObservedAt, native?.ObservedAt is null);
            var provider = native?.Provider ?? ProviderState.Unknown; var inactive = state is "stopped" or "sleeping";
            Add("agent.provider", target, provider == ProviderState.Present ? "pass" : provider == ProviderState.Missing ? "fail" : provider == ProviderState.NotRequired || inactive ? "not-applicable" : "unknown", provider == ProviderState.Present ? "Native provider metadata is present; no inference or credential refresh was performed" : provider == ProviderState.Missing ? "Native provider metadata is missing" : provider == ProviderState.NotRequired ? "Selected native provider does not require an account" : inactive ? "No native provider was started to inspect this sleeping or stopped agent" : "Provider metadata could not be observed", provider == ProviderState.Missing ? "Sign in using the selected native harness, then explicitly resume the agent" : null, native?.ProviderObservedAt, native?.ProviderObservedAt is null);
            Add("agent.input", target, native is null || native.PendingInput ? "unknown" : "pass", native is null ? "Native input state was not observed" : native.PendingInput ? "A native message is still awaiting delivery confirmation" : "No native input is awaiting delivery confirmation", observedAt: native?.CheckedAt, unobserved: native is null);
            Add("agent.decision", target, native is null ? "unknown" : "pass", native is null ? "Native decision state was not observed" : native.PendingDecision ? "Agent is waiting for an owner decision" : "No owner decision is pending", native?.PendingDecision == true ? "Open the owner DM and answer the pending request" : null, observedAt: native?.CheckedAt, unobserved: native is null);
        }
        return Result<DiagnosticReport>.Success(new(checkedAt, scope, checks.OrderBy(value => value.Scope.InstanceKey ?? "", StringComparer.Ordinal).ThenBy(value => value.Id, StringComparer.Ordinal).ToArray()));
    }
    private static DiagnosticCheck ListenerFinding(InstanceState instance, FleetConnectionState connection, bool live, DiagnosticScope scope, long checkedAt)
    {
        if (instance.ListenerActive) return new("agent.listener", scope, "pass", checkedAt, "Listener delivery is active", null);
        if (!instance.DesiredActive) return new("agent.listener", scope, "not-applicable", checkedAt, "Agent is not selected for listener delivery", null);
        if (live && connection.Connected && !connection.DeliveryEnabled) return new("agent.listener", scope, "pass", checkedAt, "Listener delivery is deliberately paused", null);
        if (live || instance.Phase is "starting" or "waking" or "awaiting-approval") return new("agent.listener", scope, "unknown", checkedAt, "Listener delivery has not been activated", "Inspect fleet show and any pending enrollment or startup operation");
        return new("agent.listener", scope, "fail", checkedAt, "Selected agent has no live listener owner", "Inspect the agent failure and resume it explicitly if needed");
    }
}
