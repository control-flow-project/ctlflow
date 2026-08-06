using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Targets;

public static partial class PlacementContainments
{
    // Containment narrows and never widens. Global is a Placement, not an
    // authorization target: a globally placed workload still acts only through
    // the non-Global invocation it is serving. This operation reads no path.
    public static ValueTask<bool> AdmitTarget(
        PlacementContainment containment,
        PolicyTarget target,
        PrincipalId subjectAccount,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(containment switch
        {
            PlacementContainment.Global => true,
            PlacementContainment.Tenant tenant =>
                target.TenantId == tenant.TenantId,
            PlacementContainment.Workspace workspace =>
                target.TenantId == workspace.TenantId
                && target.WorkspaceId == workspace.WorkspaceId,
            PlacementContainment.User user =>
                target.TenantId == user.TenantId
                && target.WorkspaceId is null
                && subjectAccount == user.AccountPrincipalId,
            _ => false
        });
    }
}
