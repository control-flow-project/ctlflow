using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<Tenant> RestoreTenant(
        TenantId id,
        TenantDisplayName displayName,
        LifecycleState lifecycle,
        TenantRevision revision,
        TenantProvisioningGeneration provisioningGeneration,
        LifecycleOperationId? currentOperationId,
        ResourceEventSequence lastEventSequence,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new Tenant(
            id,
            displayName,
            lifecycle,
            revision,
            provisioningGeneration,
            currentOperationId,
            lastEventSequence,
            createdAt,
            updatedAt));
    }
}
