using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    public static async Task<IdentityRemoval> RemoveTenantMember(
        IdentityDatabase identityDatabase,
        AccountId accountId,
        TenantId tenantId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"tenant-member:{tenantId.Value}:{accountId.Value}",
            cancellation);
        using var activity =
            IdentityDbTelemetry.StartOperation("remove_tenant_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var accountValue = accountId.Value;
        var tenantValue = tenantId.Value;
        var queryCancellation = cancellation;
        var membership = await database.TenantMemberships
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue,
                queryCancellation);
        var hasWorkspaceMembership = await database.WorkspaceMemberships
            .AnyAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue,
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
                storedGroup => EF.Property<string>(storedGroup, "_tenantId")
                    == tenantValue,
                queryCancellation);
        var hasExternalLink = await database.ExternalIdentityLinks.AnyAsync(
            candidate =>
                EF.Property<string>(candidate, "_accountId") == accountValue
                && EF.Property<string>(candidate, "_tenantId")
                    == tenantValue,
            queryCancellation);
        var result =
            await Domain.Memberships.Memberships.RemoveTenantMember(
                membership,
                hasWorkspaceMembership,
                hasGroupMembership,
                hasExternalLink,
                accountId,
                tenantId,
                audit,
                cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        database.TenantMemberships.Remove(membership!);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
