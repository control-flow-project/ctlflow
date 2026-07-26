using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    internal static async Task<Revision?> FindMembershipRevision(
        IdentityDatabase identityDatabase,
        AccountId accountId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "find_membership_revision");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var accountValue = accountId.Value;
        var tenantValue = target.TenantId.Value;
        var queryCancellation = cancellation;
        if (target.WorkspaceId is null)
        {
            return await database.TenantMemberships
                .AsNoTracking()
                .Where(membership =>
                    EF.Property<string>(
                        membership,
                        "_accountId") == accountValue
                    && EF.Property<string>(
                        membership,
                        "_tenantId") == tenantValue)
                .Select(membership => membership.Revision)
                .SingleOrDefaultAsync(queryCancellation);
        }

        var workspaceValue = target.WorkspaceId.Value;
        return await database.WorkspaceMemberships
            .AsNoTracking()
            .Where(workspace =>
                EF.Property<string>(
                    workspace,
                    "_accountId") == accountValue
                && EF.Property<string>(
                    workspace,
                    "_tenantId") == tenantValue
                && EF.Property<string>(
                    workspace,
                    "_workspaceId") == workspaceValue)
            .Join(
                database.TenantMemberships.AsNoTracking(),
                workspace => new
                {
                    AccountId = EF.Property<string>(
                        workspace,
                        "_accountId"),
                    TenantId = EF.Property<string>(
                        workspace,
                        "_tenantId")
                },
                tenant => new
                {
                    AccountId = EF.Property<string>(
                        tenant,
                        "_accountId"),
                    TenantId = EF.Property<string>(
                        tenant,
                        "_tenantId")
                },
                (workspace, _) => workspace.Revision)
            .SingleOrDefaultAsync(queryCancellation);
    }
}
