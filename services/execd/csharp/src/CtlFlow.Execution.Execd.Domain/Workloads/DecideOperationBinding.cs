using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    // Parentage is exactly Global -> Tenant -> Workspace|User, so a complete
    // ancestry is at most three records.
    public const int MaximumPlacementChainLength = 3;

    // Confirms one admitted product operation for one resolved Workload.
    //
    // Authority requires all of: an active Workload, exact membership in the
    // admitted operation snapshot, a complete and well-formed Placement
    // ancestry rooted at Global, and every ancestor effectively active. Any
    // missing condition yields null, which the caller reports as one
    // indistinguishable absence.
    public static ValueTask<WorkloadOperationBinding?> DecideOperationBinding(
        WorkloadBindingFacts facts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsCompleteLineage(facts.PlacementChain))
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Stored Workload Placement lineage is invalid");
        }

        if (facts.DesiredState != DesiredState.Active
            || !facts.OperationAdmitted)
        {
            return ValueTask.FromResult<WorkloadOperationBinding?>(null);
        }

        foreach (var placement in facts.PlacementChain)
        {
            if (placement.DesiredState != DesiredState.Active)
            {
                return ValueTask.FromResult<WorkloadOperationBinding?>(null);
            }
        }

        // The Workload's own Placement supplies the effective containment.
        return ValueTask.FromResult<WorkloadOperationBinding?>(
            new WorkloadOperationBinding(
                facts.AppId,
                facts.PackageId,
                facts.PlacementChain[0].Target));
    }

    // A lineage is complete when it is rooted at a parentless Global record and
    // every level is the exact parent of the one below it, with Tenant IDs
    // agreeing. A truncated chain, a skipped level, a repeated level, or a
    // record that still names an unread parent is not authority.
    private static bool IsCompleteLineage(
        IReadOnlyList<PlacementBindingFacts> chain)
    {
        if (chain.Count is < 1 or > MaximumPlacementChainLength)
        {
            return false;
        }

        var root = chain[^1];
        if (root.Target is not PlacementTarget.Global || root.HasParent)
        {
            return false;
        }

        for (var index = 0; index < chain.Count - 1; index++)
        {
            if (!chain[index].HasParent
                || !IsChildOf(chain[index].Target, chain[index + 1].Target))
            {
                return false;
            }
        }

        return chain.Count == RequiredChainLength(chain[0].Target);
    }

    private static bool IsChildOf(
        PlacementTarget child,
        PlacementTarget parent) =>
        (child, parent) switch
        {
            (PlacementTarget.Tenant, PlacementTarget.Global) => true,
            (PlacementTarget.Workspace workspace,
                PlacementTarget.Tenant tenant) =>
                workspace.TenantId == tenant.TenantId,
            (PlacementTarget.User user, PlacementTarget.Tenant tenant) =>
                user.TenantId == tenant.TenantId,
            _ => false
        };

    private static int RequiredChainLength(PlacementTarget target) =>
        target switch
        {
            PlacementTarget.Global => 1,
            PlacementTarget.Tenant => 2,
            _ => 3
        };
}
