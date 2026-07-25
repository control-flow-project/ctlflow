using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using WireLifecycleTarget = CtlFlow.Tenancy.V1.LifecycleTarget;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests;

internal static partial class LifecycleRequests
{
    internal static async ValueTask<LifecycleTarget> ParseLifecycleTarget(
        WireLifecycleTarget? target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (target is null)
        {
            throw new ArgumentException("Lifecycle target is required");
        }

        return target.TargetCase switch
        {
            WireLifecycleTarget.TargetOneofCase.Tenant =>
                new LifecycleTarget.Tenant(
                    await TenantId.Parse(
                        target.Tenant.TenantId,
                        cancellation)),
            WireLifecycleTarget.TargetOneofCase.Workspace =>
                new LifecycleTarget.Workspace(
                    await TenantId.Parse(
                        target.Workspace.TenantId,
                        cancellation),
                    await WorkspaceId.Parse(
                        target.Workspace.WorkspaceId,
                        cancellation)),
            _ => throw new ArgumentException(
                "Exactly one lifecycle target is required")
        };
    }
}
