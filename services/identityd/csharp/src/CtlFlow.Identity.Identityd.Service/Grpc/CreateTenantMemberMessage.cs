using CtlFlow.Identity.Identityd.Domain.Memberships;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.TenantMember
        CreateTenantMemberMessage(
            Domain.Memberships.TenantMember member) => new()
        {
            AccountId = member.Account.Id.Value,
            AccountKind = MapPrincipalKind(member.Account.Id.Principal.Kind),
            AccountEnabled = member.Account.Enabled,
            AccountRevision = checked((ulong)member.Account.Revision.Value),
            TenantId = member.Membership.TenantId.Value,
            MembershipRevision = checked(
                (ulong)member.Membership.Revision.Value)
        };
}
