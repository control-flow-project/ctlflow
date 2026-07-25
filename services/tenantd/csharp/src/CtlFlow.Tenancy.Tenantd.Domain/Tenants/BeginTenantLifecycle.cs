using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask BeginTenantLifecycle(
        Tenant tenant,
        LifecycleOperationKind operation,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCurrentState(tenant.Lifecycle, operation);

        tenant.Lifecycle = GetTransitionalLifecycleState(operation);
        tenant.ProvisioningGeneration =
            tenant.ProvisioningGeneration.Next();
        tenant.Revision = tenant.Revision.Next();
        tenant.CurrentOperationStorage = operationId.Value;
        tenant.LastEventSequence = eventSequence;
        tenant.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }

    private static void ValidateCurrentState(
        LifecycleState state,
        LifecycleOperationKind operation)
    {
        var valid = operation switch
        {
            LifecycleOperationKind.Suspend =>
                state == LifecycleState.Active,
            LifecycleOperationKind.Resume =>
                state == LifecycleState.Suspended,
            LifecycleOperationKind.Delete =>
                state is LifecycleState.Active
                    or LifecycleState.Suspended
                    or LifecycleState.Failed,
            _ => false
        };

        if (!valid)
        {
            throw new InvalidOperationException(
                "Tenant lifecycle transition is not admitted");
        }
    }
}
