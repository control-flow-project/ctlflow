using CtlFlow.Identity.Identityd.Db.Principals;
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
    public static async Task<IdentityMutation<GroupMembershipChange>>
        AddGroupMember(
            IdentityDatabase identityDatabase,
            GroupId groupId,
            PrincipalId principalId,
            IdentityTarget target,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity =
            IdentityDbTelemetry.StartOperation("add_group_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var groupValue = groupId.Value;
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var group = await database.Groups.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id") == groupValue,
            queryCancellation);
        var principal = await PrincipalQueries.LoadPrincipalFacts(
            identityDatabase,
            principalId,
            target,
            cancellation);
        var exists = principalId.Kind == PrincipalKind.Virtual
            ? await database.VirtualPrincipalGroupMemberships.AnyAsync(
                candidate =>
                    EF.Property<string>(candidate, "_principalId")
                        == principalValue
                    && EF.Property<string>(candidate, "_groupId")
                        == groupValue,
                queryCancellation)
            : await database.AccountGroupMemberships.AnyAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == principalValue
                    && EF.Property<string>(candidate, "_groupId")
                        == groupValue,
                queryCancellation);
        var result = await Domain.Groups.Groups.AddGroupMember(
            group,
            principal,
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

        if (result.Value.AccountMembership is not null)
        {
            database.AccountGroupMemberships.Add(
                result.Value.AccountMembership);
        }
        else
        {
            database.VirtualPrincipalGroupMemberships.Add(
                result.Value.VirtualMembership!);
        }

        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
