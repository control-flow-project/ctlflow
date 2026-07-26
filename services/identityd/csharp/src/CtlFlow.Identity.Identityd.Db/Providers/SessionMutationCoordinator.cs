using CtlFlow.Identity.Identityd.Domain.Sessions;

namespace CtlFlow.Identity.Identityd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> SessionMutationCoordinator(
    SessionCredentialDigest credentialDigest,
    CancellationToken cancellation);
