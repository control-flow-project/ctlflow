using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<Tenant> CreateTenant(
        TenantId id,
        TenantDisplayName displayName,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new Tenant(
            id,
            displayName,
            operationId,
            eventSequence,
            now));
    }
}
