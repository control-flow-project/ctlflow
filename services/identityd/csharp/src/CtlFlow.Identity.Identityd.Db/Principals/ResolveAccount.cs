using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Db.Memberships.Memberships;
using static CtlFlow.Identity.Identityd.Domain.Principals.Principals;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    private static async Task<PrincipalLookupResult> ResolveAccount(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "resolve_account");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var row = await database.Accounts
            .AsNoTracking()
            .Where(account =>
                EF.Property<string>(account, "_id") == principalValue)
            .Select(account => new
            {
                Id = EF.Property<string>(account, "_id"),
                account.Kind,
                account.Enabled,
                account.Revision
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return new PrincipalLookupResult.NotFound();
        }

        var accountId = AccountId.FromStorage(row.Id);
        var membershipRevision = await FindMembershipRevision(
            identityDatabase,
            accountId,
            target,
            cancellation);
        return await ResolveAccountPrincipal(
            accountId,
            row.Kind,
            row.Enabled,
            row.Revision,
            membershipRevision,
            cancellation);
    }
}
