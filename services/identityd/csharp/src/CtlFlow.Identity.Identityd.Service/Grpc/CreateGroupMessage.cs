using CtlFlow.Identity.Identityd.Domain.Groups;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.Group CreateGroupMessage(Group group)
    {
        var message = new CtlFlow.Identity.V1.Group
        {
            GroupId = group.Id.Value,
            TenantId = group.TenantId.Value
        };
        if (group.WorkspaceId is not null)
        {
            message.WorkspaceId = group.WorkspaceId.Value;
        }

        return message;
    }
}
