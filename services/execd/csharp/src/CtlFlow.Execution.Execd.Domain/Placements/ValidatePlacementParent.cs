using CtlFlow.Execution.Execd.Domain.Errors;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    public static ValueTask ValidatePlacementParent(
        PlacementTarget target,
        PlacementConstraints constraints,
        PlacementRecord? parent,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var valid = (target, parent?.Target) switch
        {
            (PlacementTarget.Global, null) => true,
            (PlacementTarget.Tenant, PlacementTarget.Global) => true,
            (
                PlacementTarget.Workspace child,
                PlacementTarget.Tenant containingTenant) =>
                child.TenantId == containingTenant.TenantId,
            (
                PlacementTarget.User child,
                PlacementTarget.Tenant containingTenant) =>
                child.TenantId == containingTenant.TenantId,
            _ => false
        };
        if (!valid)
        {
            throw new ExecutionException(
                ExecutionError.FailedPrecondition,
                "Placement parent is not the immediate containing Placement");
        }

        if (parent is not null)
        {
            constraints.EnsureNarrows(parent.Constraints);
        }

        return ValueTask.CompletedTask;
    }
}
