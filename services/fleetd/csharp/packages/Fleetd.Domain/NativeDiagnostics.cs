using Crossfire.AgentCore;

namespace Fleetd.Domain;

public sealed partial class NativeLifecycle
{
    public async ValueTask<NativeDiagnostic> Diagnostics(CancellationToken cancellation)
    {
        OwnedRuntimeConnection? connection; NativeDiagnostic diagnostic;
        lock (gate)
        {
            connection = native;
            var values = observations.Values.ToArray();
            var observed = new[] { "failed", "unavailable", "waiting-approval", "waiting-answer", "working", "idle" }.FirstOrDefault(state => values.Any(value => value.State == state));
            var latest = values.Where(value => value.State == observed).OrderByDescending(value => value.ObservedAt).FirstOrDefault(); var checkedAt = Now;
            var state = phase != "running" ? phase : observed ?? "unknown";
            diagnostic = new(state, phase == "running" ? latest?.ObservedAt : checkedAt, ProviderState.Unknown, null, unsettled.Count != 0 || services.Hooks.PendingInput?.Invoke() == true, services.Hooks.PendingDecisions?.Invoke() == true, checkedAt);
        }
        if (connection is null || connection.Lifetime.IsCancellationRequested || cancellation.IsCancellationRequested) return diagnostic;
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, lifetime.Token);
        try
        {
            var provider = await connection.Provider(scope.Token).AsTask().WaitAsync(scope.Token);
            lock (gate) if (ReferenceEquals(native, connection) && !connection.Lifetime.IsCancellationRequested && !scope.IsCancellationRequested && provider.IsSuccess)
                return diagnostic with { Provider = provider.Value, ProviderObservedAt = Now };
        }
        catch (Exception error) when (error is OperationCanceledException or IOException or InvalidOperationException) { }
        return diagnostic;
    }
}
