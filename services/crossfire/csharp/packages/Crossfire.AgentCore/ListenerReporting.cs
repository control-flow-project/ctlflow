using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record ListenerReportingOptions(Coordination Coordination, string Agent, string Release, ListenerControl Control,
    ListenerStatistics Statistics, TimeProvider Clock, Action<string> Log, Action<string> Updated,
    Action<string, ListenerController> Started, Action<Failure> Failed);

public sealed class ListenerReporting(ListenerReportingOptions options, CancellationToken lifetime)
{
    private readonly object gate = new();
    private TaskCompletionSource<string> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private ListenerActivity? activity;
    private CancellationToken generation;
    private CancellationTokenSource? scope;
    private CancellationTokenRegistration failure;
    private string? CurrentRun()
    {
        var current = options.Control.Current();
        return activity is not null && !activity.Failed.IsCancellationRequested && current.Connected && current.ConnectionGeneration == generation
            ? activity.RunId : null;
    }
    public string? RunId { get { lock (gate) return CurrentRun(); } }
    public async ValueTask<Result<string>> Ready(CancellationToken cancellation)
    {
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime, cancellation);
        try
        {
            for (;;)
            {
                scope.Token.ThrowIfCancellationRequested(); Task<string> pending;
                lock (gate)
                {
                    if (CurrentRun() is { } current) return Result<string>.Success(current);
                    if (ready.Task.IsCompleted) ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
                    pending = ready.Task;
                }
                await pending.WaitAsync(scope.Token);
            }
        }
        catch (OperationCanceledException) { return Results.Fail<string>("unavailable", "Listener reporting is not ready"); }
    }
    public void Delivered(int count) => activity?.Delivered(count);
    public async ValueTask<Result<bool>> Activate()
    {
        var current = options.Control.Current();
        if (!current.Connected) { await Pause(); return Result<bool>.Success(false); }
        if (activity is not null && !activity.Failed.IsCancellationRequested && current.ConnectionGeneration == generation) return Result<bool>.Success(true);
        await Pause(); lifetime.ThrowIfCancellationRequested();
        if (current.ConnectionGeneration.IsCancellationRequested || !options.Control.Current().Connected) return Result<bool>.Success(false);
        scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime, current.ConnectionGeneration); var binding = options.Control.Binding();
        var result = await ListenerActivity.Start(options.Coordination, options.Agent, options.Release, binding, options.Statistics, options.Clock, scope.Token, options.Log, options.Updated);
        if (!result.IsSuccess)
        {
            scope.Dispose(); scope = null; lifetime.ThrowIfCancellationRequested();
            if (current.ConnectionGeneration.IsCancellationRequested) return Result<bool>.Success(false);
            if (!Retryable(result.Error)) return Result<bool>.Fail(result.Error);
            options.Control.Unavailable(result.Error.Message); return Result<bool>.Success(false);
        }
        var reporter = result.Value;
        lock (gate) { activity = reporter; generation = current.ConnectionGeneration; ready.TrySetResult(reporter.RunId); }
        failure = reporter.Failed.Register(() =>
        {
            if (!ReferenceEquals(activity, reporter) || current.ConnectionGeneration.IsCancellationRequested || lifetime.IsCancellationRequested) return;
            var error = reporter.Error ?? new Failure("unavailable", "Listener reporting unavailable");
            if (Retryable(error)) options.Control.Unavailable(error.Message); else options.Failed(error);
        });
        options.Started(reporter.RunId, binding);
        return Result<bool>.Success(!current.ConnectionGeneration.IsCancellationRequested && options.Control.Current().Connected);
    }
    public async ValueTask Pause()
    {
        failure.Dispose(); ListenerActivity? previous;
        lock (gate) { previous = activity; activity = null; if (ready.Task.IsCompleted) ready = new(TaskCreationOptions.RunContinuationsAsynchronously); }
        try { if (previous is not null) await previous.DisposeAsync(); }
        finally { scope?.Dispose(); scope = null; }
    }
    private static bool Retryable(Failure error) => error.Code is "native" or "unavailable" or "body_too_large";
}
