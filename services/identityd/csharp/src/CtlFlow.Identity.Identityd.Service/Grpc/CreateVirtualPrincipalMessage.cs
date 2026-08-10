using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.VirtualPrincipal
        CreateVirtualPrincipalMessage(VirtualPrincipal principal)
    {
        var message = new CtlFlow.Identity.V1.VirtualPrincipal
        {
            PrincipalId = principal.Id.Value,
            SubjectAccountId = principal.SubjectAccountId.Value,
            Enabled = principal.Enabled,
            Revision = checked((ulong)principal.Revision.Value),
            TenantId = principal.TenantFenceId.Value
        };
        if (principal.WorkspaceFenceId is not null)
        {
            message.WorkspaceId = principal.WorkspaceFenceId.Value;
        }

        return message;
    }
}
