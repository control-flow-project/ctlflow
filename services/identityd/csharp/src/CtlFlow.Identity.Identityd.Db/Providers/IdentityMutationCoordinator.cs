namespace CtlFlow.Identity.Identityd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> IdentityMutationCoordinator(
    CancellationToken cancellation);
