using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    internal static Task ResumeWorkspace(HttpContext context) =>
        ChangeWorkspaceLifecycle(context, LifecycleOperationKind.Resume);
}
