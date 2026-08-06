using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Targets;

public static partial class PlacementContainments
{
    // A User-placed workload owns only its account-scoped path. The caller
    // invokes this operation only after target containment and path anchoring.
    public static ValueTask<bool> AdmitResourceScope(
        PlacementContainment containment,
        PrincipalId? pathAccountScope,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            containment is not PlacementContainment.User user
            || pathAccountScope == user.AccountPrincipalId);
    }
}
