using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    public static async Task<IdentityRemoval> RemoveGroupMember(
        IdentityDatabase identityDatabase,
        GroupId groupId,
        PrincipalId principalId,
        IdentityTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"group-member:{groupId.Value}:{principalId.Value}",
            cancellation);
        using var activity =
            IdentityDbTelemetry.StartOperation("remove_group_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var groupValue = groupId.Value;
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var group = await database.Groups.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id") == groupValue,
            queryCancellation);
        AccountGroupMembership? accountMembership = null;
        VirtualPrincipalGroupMembership? virtualMembership = null;
        if (principalId.Kind == PrincipalKind.Virtual)
        {
            virtualMembership = await database
                .VirtualPrincipalGroupMemberships.SingleOrDefaultAsync(
                    candidate =>
                        EF.Property<string>(candidate, "_principalId")
                            == principalValue
                        && EF.Property<string>(candidate, "_groupId")
                            == groupValue,
                    queryCancellation);
        }
        else
        {
            accountMembership = await database.AccountGroupMemberships
                .SingleOrDefaultAsync(
                    candidate =>
                        EF.Property<string>(candidate, "_accountId")
                            == principalValue
                        && EF.Property<string>(candidate, "_groupId")
                            == groupValue,
                    queryCancellation);
        }

        var exists = accountMembership is not null
            || virtualMembership is not null;
        var result = await Domain.Groups.Groups.RemoveGroupMember(
            group,
            exists,
            groupId,
            principalId,
            target,
            audit,
            cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        if (accountMembership is not null)
        {
            database.AccountGroupMemberships.Remove(accountMembership);
        }
        else
        {
            database.VirtualPrincipalGroupMemberships.Remove(
                virtualMembership!);
        }

        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
