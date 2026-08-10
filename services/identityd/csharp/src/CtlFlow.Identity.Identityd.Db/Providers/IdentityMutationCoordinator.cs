namespace CtlFlow.Identity.Identityd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> IdentityMutationCoordinator(
    string mutationKey,
    CancellationToken cancellation);
