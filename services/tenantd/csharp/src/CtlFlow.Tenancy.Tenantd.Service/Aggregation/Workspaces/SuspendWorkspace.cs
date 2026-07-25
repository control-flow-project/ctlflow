using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    internal static Task SuspendWorkspace(HttpContext context) =>
        ChangeWorkspaceLifecycle(context, LifecycleOperationKind.Suspend);
}
