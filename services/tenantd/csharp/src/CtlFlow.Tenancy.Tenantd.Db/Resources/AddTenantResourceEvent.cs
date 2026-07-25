using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceEvents
{
    internal static void AddTenantResourceEvent(
        TenantDbContext database,
        Tenant tenant,
        ResourceEventKind eventKind,
        IReadOnlyList<LifecycleStep> currentSteps,
        UtcInstant now)
    {
        database.ResourceEvents.Add(new ResourceEvent(
            tenant.LastEventSequence.Value,
            1,
            (int)eventKind,
            tenant.Id.Value,
            null,
            tenant.DisplayName.Value,
            ToStorage(tenant.Lifecycle),
            tenant.Revision.Value,
            tenant.ProvisioningGeneration.Value,
            tenant.CurrentOperationId?.Value,
            now.UnixMilliseconds));
        AddResourceEventConditions(
            database,
            tenant.LastEventSequence.Value,
            currentSteps);
    }
}
