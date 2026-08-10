using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    public static async Task<IdentityMutation<TenantMember>> AddTenantMember(
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
            IdentityDbTelemetry.StartOperation("add_tenant_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var accountValue = accountId.Value;
        var tenantValue = tenantId.Value;
        var queryCancellation = cancellation;
        var account = await database.Accounts.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id")
                == accountValue,
            queryCancellation);
        var membership = await database.TenantMemberships
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue,
                queryCancellation);
        var result = await Domain.Memberships.Memberships.AddTenantMember(
            account,
            membership,
            accountId,
            tenantId,
            audit,
            cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        if (account is null)
        {
            database.Accounts.Add(result.Value.Account);
        }

        database.TenantMemberships.Add(result.Value.Membership);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
