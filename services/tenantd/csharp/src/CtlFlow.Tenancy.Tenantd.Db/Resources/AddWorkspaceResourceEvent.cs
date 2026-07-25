using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceEvents
{
    internal static void AddWorkspaceResourceEvent(
        TenantDbContext database,
        Workspace workspace,
        ResourceEventKind eventKind,
        IReadOnlyList<LifecycleStep> currentSteps,
        UtcInstant now)
    {
        database.ResourceEvents.Add(new ResourceEvent(
            workspace.LastEventSequence.Value,
            2,
            (int)eventKind,
            workspace.TenantId.Value,
            workspace.Id.Value,
            workspace.DisplayName.Value,
            ToStorage(workspace.Lifecycle),
            workspace.Revision.Value,
            workspace.ProvisioningGeneration.Value,
            workspace.CurrentOperationId?.Value,
            now.UnixMilliseconds));
        AddResourceEventConditions(
            database,
            workspace.LastEventSequence.Value,
            currentSteps);
    }
}
