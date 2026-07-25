using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask ApplyTenantLifecycleProgress(
        Tenant tenant,
        LifecycleOperationKind operation,
        bool blocked,
        bool complete,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (tenant.CurrentOperationId is null)
        {
            throw new InvalidOperationException(
                "Tenant has no current lifecycle operation");
        }

        if (blocked)
        {
            tenant.Lifecycle = LifecycleState.Failed;
        }
        else if (complete)
        {
            tenant.Lifecycle = GetCompletedLifecycleState(operation);
            tenant.CurrentOperationStorage = null;
        }

        tenant.Revision = tenant.Revision.Next();
        tenant.LastEventSequence = eventSequence;
        tenant.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
