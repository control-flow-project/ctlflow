using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<bool> ContainsTarget(
        InvocationIdentity invocation,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var contained = invocation.Fence.TenantId == target.TenantId
            && (
                target.WorkspaceId is null
                || invocation.Fence.WorkspaceId is null
                || invocation.Fence.WorkspaceId == target.WorkspaceId);
        return ValueTask.FromResult(contained);
    }
}
