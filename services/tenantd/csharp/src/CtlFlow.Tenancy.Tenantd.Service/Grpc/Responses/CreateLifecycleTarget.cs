using DomainLifecycleTarget =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTarget;
using WireLifecycleTarget = CtlFlow.Tenancy.V1.LifecycleTarget;
using WireTenantTarget = CtlFlow.Tenancy.V1.TenantTarget;
using WireWorkspaceTarget = CtlFlow.Tenancy.V1.WorkspaceTarget;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static WireLifecycleTarget CreateLifecycleTarget(
        DomainLifecycleTarget target) =>
        target switch
        {
            DomainLifecycleTarget.Tenant tenant =>
                new WireLifecycleTarget
                {
                    Tenant = new WireTenantTarget
                    {
                        TenantId = tenant.TenantId.Value
                    }
                },
            DomainLifecycleTarget.Workspace workspace =>
                new WireLifecycleTarget
                {
                    Workspace = new WireWorkspaceTarget
                    {
                        TenantId = workspace.TenantId.Value,
                        WorkspaceId = workspace.WorkspaceId.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Lifecycle target is invalid")
        };
}
