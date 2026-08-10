using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public static partial class Principals
{
    public static ValueTask<VirtualPrincipal> RequireVirtualPrincipal(
        VirtualPrincipal? principal,
        IdentityTarget fence,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (principal is null
            || principal.TenantFenceId != fence.TenantId
            || principal.WorkspaceFenceId != fence.WorkspaceId)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(principal);
    }
}
