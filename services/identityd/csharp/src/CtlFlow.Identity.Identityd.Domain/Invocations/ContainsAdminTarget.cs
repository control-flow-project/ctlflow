using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<bool> ContainsAdminTarget(
        InvocationIdentity invocation,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (invocation.Fence.TenantId != target.TenantId)
        {
            return ValueTask.FromResult(false);
        }

        return ValueTask.FromResult(
            invocation.Fence.WorkspaceId is null
                || invocation.Fence.WorkspaceId == target.WorkspaceId);
    }
}
