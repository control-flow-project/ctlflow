using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    public static async Task<IdentityRemoval> RemoveWorkspaceMember(
        IdentityDatabase identityDatabase,
        AccountId accountId,
        TenantId tenantId,
        WorkspaceId workspaceId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"workspace-member:{tenantId.Value}:{workspaceId.Value}:{accountId.Value}",
            cancellation);
        using var activity =
            IdentityDbTelemetry.StartOperation("remove_workspace_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var accountValue = accountId.Value;
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var queryCancellation = cancellation;
        var membership = await database.WorkspaceMemberships
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue
                    && EF.Property<string>(candidate, "_workspaceId")
                        == workspaceValue,
                queryCancellation);
        var hasGroupMembership = await database.AccountGroupMemberships
            .Where(relation => EF.Property<string>(relation, "_accountId")
                == accountValue)
            .Join(
                database.Groups,
                relation => EF.Property<string>(relation, "_groupId"),
                storedGroup => EF.Property<string>(storedGroup, "_id"),
                (_, storedGroup) => storedGroup)
            .AnyAsync(
                storedGroup =>
                    EF.Property<string>(storedGroup, "_tenantId")
                        == tenantValue
                    && EF.Property<string?>(storedGroup, "_workspaceId")
                        == workspaceValue,
                queryCancellation);
        var result =
            await Domain.Memberships.Memberships.RemoveWorkspaceMember(
                membership,
                hasGroupMembership,
                accountId,
                tenantId,
                workspaceId,
                audit,
                cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        database.WorkspaceMemberships.Remove(membership!);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
