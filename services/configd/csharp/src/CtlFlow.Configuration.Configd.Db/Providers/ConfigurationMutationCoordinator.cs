namespace CtlFlow.Configuration.Configd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> ConfigurationMutationCoordinator(
    CancellationToken cancellation);
