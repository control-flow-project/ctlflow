using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    public static async Task<Page<TenantMember>> ListTenantMembers(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        PageSize pageSize,
        AccountId? afterAccountId,
        CancellationToken cancellation)
    {
        using var activity =
            IdentityDbTelemetry.StartOperation("list_tenant_members");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var afterValue = afterAccountId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var rows = await database.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                EF.Property<string>(membership, "_tenantId") == tenantValue
                && string.Compare(
                    EF.Property<string>(membership, "_accountId"),
                    afterValue) > 0)
            .Join(
                database.Accounts.AsNoTracking(),
                membership => EF.Property<string>(membership, "_accountId"),
                account => EF.Property<string>(account, "_id"),
                (membership, account) => new
                {
                    AccountId = EF.Property<string>(account, "_id"),
                    AccountKind = account.Kind,
                    AccountEnabled = account.Enabled,
                    AccountRevision = account.Revision,
                    TenantId = EF.Property<string>(membership, "_tenantId"),
                    MembershipRevision = membership.Revision
                })
            .OrderBy(row => row.AccountId)
            .Take(take)
            .ToListAsync(queryCancellation);
        var members = rows
            .Select(row =>
            {
                var accountId = AccountId.FromStorage(row.AccountId);
                if (accountId.Kind != row.AccountKind)
                {
                    throw new InvalidOperationException(
                        "Stored account kind does not match its ID");
                }

                var account = new Account(
                    accountId,
                    row.AccountEnabled,
                    row.AccountRevision);
                var membership = new TenantMembership(
                    accountId,
                    Domain.Tenants.TenantId.FromStorage(row.TenantId),
                    row.MembershipRevision);
                return new TenantMember(account, membership);
            })
            .ToArray();
        return await CreatePage(
            members,
            pageSize,
            member => member.Account.Id.Value,
            cancellation);
    }
}
