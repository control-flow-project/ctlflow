namespace CtlFlow.Execution.Execd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> ExecutionMutationCoordinator(
    CancellationToken cancellation);
