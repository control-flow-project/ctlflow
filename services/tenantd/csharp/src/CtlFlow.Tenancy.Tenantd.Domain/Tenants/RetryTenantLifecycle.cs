using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask RetryTenantLifecycle(
        Tenant tenant,
        LifecycleOperationKind operation,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (tenant.Lifecycle != LifecycleState.Failed
            || tenant.CurrentOperationId != operationId)
        {
            throw new InvalidOperationException(
                "Tenant has no matching failed lifecycle operation");
        }

        tenant.Lifecycle = GetTransitionalLifecycleState(operation);
        tenant.Revision = tenant.Revision.Next();
        tenant.LastEventSequence = eventSequence;
        tenant.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
