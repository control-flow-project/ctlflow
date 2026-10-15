using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record ListenerReportingOptions(Coordination Coordination, string Agent, string Release, ListenerControl Control,
    ListenerStatistics Statistics, TimeProvider Clock, Action<string> Log, Action<string> Updated,
    Action<string, ListenerController> Started, Action<Failure> Failed);

public sealed class ListenerReporting(ListenerReportingOptions options, CancellationToken lifetime)
{
    private ListenerActivity? activity;
    private CancellationToken generation;
    private CancellationTokenSource? scope;
    private CancellationTokenRegistration failure;
    public string? RunId => activity?.RunId;
    public void Delivered(int count) => activity?.Delivered(count);
    public async ValueTask<Result<bool>> Activate()
    {
        var current = options.Control.Current();
        if (!current.Active) { await Pause(); return Result<bool>.Success(false); }
        if (activity is not null && !activity.Failed.IsCancellationRequested && current.Generation == generation) return Result<bool>.Success(true);
        await Pause(); lifetime.ThrowIfCancellationRequested();
        if (current.Generation.IsCancellationRequested || !options.Control.Current().Active) return Result<bool>.Success(false);
        scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime, current.Generation); var binding = options.Control.Binding();
        var result = await ListenerActivity.Start(options.Coordination, options.Agent, options.Release, binding, options.Statistics, options.Clock, scope.Token, options.Log, options.Updated);
        if (!result.IsSuccess)
        {
            scope.Dispose(); scope = null; lifetime.ThrowIfCancellationRequested();
            if (current.Generation.IsCancellationRequested) return Result<bool>.Success(false);
            if (!Retryable(result.Error)) return Result<bool>.Fail(result.Error);
            options.Control.Unavailable(result.Error.Message); return Result<bool>.Success(false);
        }
        var reporter = result.Value; activity = reporter; generation = current.Generation;
        failure = reporter.Failed.Register(() =>
        {
            if (!ReferenceEquals(activity, reporter) || current.Generation.IsCancellationRequested || lifetime.IsCancellationRequested) return;
            var error = reporter.Error ?? new Failure("unavailable", "Listener reporting unavailable");
            if (Retryable(error)) options.Control.Unavailable(error.Message); else options.Failed(error);
        });
        options.Started(reporter.RunId, binding);
        return Result<bool>.Success(!current.Generation.IsCancellationRequested && options.Control.Current().Active);
    }
    public async ValueTask Pause()
    {
        failure.Dispose(); var previous = activity; activity = null;
        try { if (previous is not null) await previous.DisposeAsync(); }
        finally { scope?.Dispose(); scope = null; }
    }
    private static bool Retryable(Failure error) => error.Code is "native" or "unavailable" or "body_too_large";
}
