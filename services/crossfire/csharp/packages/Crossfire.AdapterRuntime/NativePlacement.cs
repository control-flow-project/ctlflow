using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Crossfire.AdapterRuntime;

public sealed record NativeLeaseRequest(string Directory, string Workspace, string StateDirectory, string Home);

// Releasing native ownership includes closing its selected execution boundary.
// A VM owner must finish guest/helper teardown before its release completes.
public sealed class NativeLease(NativeExecution execution, Func<ValueTask> release) : IAsyncDisposable
{
    private readonly object gate = new();
    private Task? closing;
    public NativeExecution Execution { get; } = execution;
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate)
        {
            if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; }
            selected = closing;
        }
        if (completion is not null) _ = Close(completion);
        return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        try { await release(); completion.TrySetResult(); }
        catch (Exception error) { completion.TrySetException(error); }
    }
}

public sealed record NativePlacement(Func<NativeLeaseRequest, CancellationToken, ValueTask<Result<NativeLease>>> Open)
{
    public static NativePlacement Host { get; } = Local(NativeExecution.Host);
    public static NativePlacement Local(NativeExecution execution) => new((request, cancellation) =>
    {
        cancellation.ThrowIfCancellationRequested();
        try
        {
            var ownership = NativeOwnership.Acquire(request.Directory, request.Workspace, request.Home);
            return ValueTask.FromResult(Result<NativeLease>.Success(new(execution, () => { ownership.Dispose(); return ValueTask.CompletedTask; })));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { return ValueTask.FromResult(Results.Fail<NativeLease>("native", "Cannot acquire exclusive native ownership: " + error.Message)); }
    });
}
