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
    private static async Task<PrincipalLookupResult> ResolveVirtual(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "resolve_virtual");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var row = await database.VirtualPrincipals
            .AsNoTracking()
            .Where(principal =>
                EF.Property<string>(
                    principal,
                    "_id") == principalValue)
            .Join(
                database.Accounts.AsNoTracking(),
                principal => EF.Property<string>(
                    principal,
                    "_subjectAccountId"),
                account => EF.Property<string>(account, "_id"),
                (principal, account) => new
                {
                    PrincipalId =
                        EF.Property<string>(principal, "_id"),
                    PrincipalEnabled = principal.Enabled,
                    PrincipalRevision = principal.Revision,
                    AccountId = EF.Property<string>(account, "_id"),
                    AccountKind = account.Kind,
                    AccountEnabled = account.Enabled,
                    AccountRevision = account.Revision,
                    TenantFenceId = EF.Property<string>(
                        principal,
                        "_tenantFenceId"),
                    WorkspaceFenceId = EF.Property<string?>(
                        principal,
                        "_workspaceFenceId")
                })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return new PrincipalLookupResult.NotFound();
        }

        var accountId = AccountId.FromStorage(row.AccountId);
        var membershipRevision = await FindMembershipRevision(
            identityDatabase,
            accountId,
            target,
            cancellation);
        return await ResolveVirtualPrincipal(
            VirtualPrincipalId.FromStorage(row.PrincipalId),
            row.PrincipalEnabled,
            row.PrincipalRevision,
            accountId,
            row.AccountKind,
            row.AccountEnabled,
            row.AccountRevision,
            Domain.Tenants.TenantId.FromStorage(row.TenantFenceId),
            row.WorkspaceFenceId is null
                ? null
                : Domain.Workspaces.WorkspaceId.FromStorage(
                    row.WorkspaceFenceId),
            target,
            membershipRevision,
            cancellation);
    }
}
