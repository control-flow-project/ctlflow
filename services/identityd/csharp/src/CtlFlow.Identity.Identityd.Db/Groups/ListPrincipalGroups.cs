using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    public static async Task<GroupPage> ListPrincipalGroups(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        PageSize pageSize,
        GroupId? afterGroupId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return principalId.Kind switch
        {
            PrincipalKind.Human or PrincipalKind.Service =>
                await ListAccountPrincipalGroups(
                    identityDatabase,
                    principalId,
                    target,
                    pageSize,
                    afterGroupId,
                    cancellation),
            PrincipalKind.Virtual =>
                await ListVirtualPrincipalGroups(
                    identityDatabase,
                    principalId,
                    target,
                    pageSize,
                    afterGroupId,
                    cancellation),
            _ => throw new InvalidOperationException(
                "Unknown principal kind")
        };
    }
}
