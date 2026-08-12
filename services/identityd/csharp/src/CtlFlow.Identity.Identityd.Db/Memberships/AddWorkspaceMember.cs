using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

public static partial class Memberships
{
    public static async Task<IdentityMutation<WorkspaceMember>>
        AddWorkspaceMember(
            IdentityDatabase identityDatabase,
            AccountId accountId,
            TenantId tenantId,
            WorkspaceId workspaceId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity =
            IdentityDbTelemetry.StartOperation("add_workspace_member");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var accountValue = accountId.Value;
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var queryCancellation = cancellation;
        var account = await database.Accounts.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id")
                == accountValue,
            queryCancellation);
        var tenantMembership = await database.TenantMemberships
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue,
                queryCancellation);
        var workspaceMembership = await database.WorkspaceMemberships
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantValue
                    && EF.Property<string>(candidate, "_workspaceId")
                        == workspaceValue,
                queryCancellation);
        var result =
            await Domain.Memberships.Memberships.AddWorkspaceMember(
                account,
                tenantMembership,
                workspaceMembership,
                accountId,
                tenantId,
                workspaceId,
                audit,
                cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        database.WorkspaceMemberships.Add(result.Value.Membership);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
