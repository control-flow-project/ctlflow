using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask UpdateTenantDisplayName(
        Tenant tenant,
        TenantDisplayName displayName,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsDisplayMetadataUpdateAdmitted(tenant.Lifecycle))
        {
            throw new InvalidOperationException(
                "Tenant lifecycle does not admit display-name updates");
        }

        tenant.DisplayName = displayName;
        tenant.Revision = tenant.Revision.Next();
        tenant.LastEventSequence = eventSequence;
        tenant.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
