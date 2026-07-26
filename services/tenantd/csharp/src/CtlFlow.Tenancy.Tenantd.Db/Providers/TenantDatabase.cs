using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Providers;

public sealed record TenantDatabase(
    IDbContextFactory<TenantDbContext> Contexts,
    TenantMutationCoordinator AcquireMutation);
