using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<IdentityTarget?>
        ResolveAdministrationPolicyTarget(
            InvocationIdentity invocation,
            IdentityTarget requestedTarget,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (invocation.Fence.TenantId != requestedTarget.TenantId)
        {
            return ValueTask.FromResult<IdentityTarget?>(null);
        }

        if (invocation.Fence.WorkspaceId is not null
            && invocation.Fence.WorkspaceId != requestedTarget.WorkspaceId)
        {
            return ValueTask.FromResult<IdentityTarget?>(null);
        }

        return ValueTask.FromResult<IdentityTarget?>(invocation.Fence);
    }
}
