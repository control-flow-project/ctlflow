using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    // Containment precedes every path step, so a request outside the
    // workload's Placement is concealed rather than answered with the detail
    // of a resource it may not see.
    private static async ValueTask EnsurePlacementFence(
        PlacementContainment containment,
        PolicyTarget target,
        InvocationIdentity invocation,
        CancellationToken cancellation)
    {
        if (!await PlacementContainments.AdmitTarget(
                containment,
                target,
                invocation.SubjectAccount,
                cancellation))
        {
            throw new TargetNotFoundException();
        }
    }

    // The account-scoped resource requirement of a User Placement, applied
    // after the anchor established the path's canonical scope.
    private static async ValueTask EnsureResourceScope(
        PlacementContainment containment,
        PrincipalId? pathAccountScope,
        CancellationToken cancellation)
    {
        if (!await PlacementContainments.AdmitResourceScope(
                containment,
                pathAccountScope,
                cancellation))
        {
            throw new TargetNotFoundException();
        }
    }
}
