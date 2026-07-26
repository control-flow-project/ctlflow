using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Providers;

public delegate ValueTask<IAsyncDisposable> TenantMutationCoordinator(
    TenantId tenantId,
    CancellationToken cancellation);
