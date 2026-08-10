using CtlFlow.Identity.Identityd.Domain.Groups;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.GroupMember CreateGroupMemberMessage(
        GroupMember member)
    {
        var message = new CtlFlow.Identity.V1.GroupMember
        {
            GroupId = member.Group.Id.Value,
            PrincipalId = member.PrincipalId.Value,
            PrincipalKind = MapPrincipalKind(member.PrincipalKind),
            TenantId = member.Group.TenantId.Value
        };
        if (member.Group.WorkspaceId is not null)
        {
            message.WorkspaceId = member.Group.WorkspaceId.Value;
        }

        return message;
    }
}
