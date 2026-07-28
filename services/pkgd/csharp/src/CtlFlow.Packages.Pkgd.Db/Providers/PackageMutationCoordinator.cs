namespace CtlFlow.Packages.Pkgd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> PackageMutationCoordinator(
    CancellationToken cancellation);
