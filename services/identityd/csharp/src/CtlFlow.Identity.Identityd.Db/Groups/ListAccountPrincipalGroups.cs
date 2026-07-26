using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Groups.Groups;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    private static async Task<GroupPage> ListAccountPrincipalGroups(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        PageSize pageSize,
        GroupId? afterGroupId,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "list_account_principal_groups");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var tenantValue = target.TenantId.Value;
        var workspaceValue = target.WorkspaceId?.Value;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        List<string> rows;

        if (afterGroupId is null)
        {
            rows = await database.AccountGroupMemberships
                .AsNoTracking()
                .Where(membership => EF.Property<string>(
                    membership,
                    "_accountId") == principalValue)
                .Join(
                    database.Groups.AsNoTracking(),
                    membership => EF.Property<string>(
                        membership,
                        "_groupId"),
                    resourceGroup => EF.Property<string>(
                        resourceGroup,
                        "_id"),
                    (_, resourceGroup) => resourceGroup)
                .Where(resourceGroup =>
                    EF.Property<string>(
                        resourceGroup,
                        "_tenantId") == tenantValue
                    && EF.Property<string?>(
                        resourceGroup,
                        "_workspaceId") == workspaceValue)
                .OrderBy(resourceGroup => EF.Property<string>(
                    resourceGroup,
                    "_id"))
                .Select(resourceGroup => EF.Property<string>(
                    resourceGroup,
                    "_id"))
                .Take(take)
                .ToListAsync(queryCancellation);
        }
        else
        {
            var afterValue = afterGroupId.Value;
            rows = await database.AccountGroupMemberships
                .AsNoTracking()
                .Where(membership => EF.Property<string>(
                    membership,
                    "_accountId") == principalValue)
                .Join(
                    database.Groups.AsNoTracking(),
                    membership => EF.Property<string>(
                        membership,
                        "_groupId"),
                    resourceGroup => EF.Property<string>(
                        resourceGroup,
                        "_id"),
                    (_, resourceGroup) => resourceGroup)
                .Where(resourceGroup =>
                    EF.Property<string>(
                        resourceGroup,
                        "_tenantId") == tenantValue
                    && EF.Property<string?>(
                        resourceGroup,
                        "_workspaceId") == workspaceValue
                    && string.Compare(
                        EF.Property<string>(
                            resourceGroup,
                            "_id"),
                        afterValue) > 0)
                .OrderBy(resourceGroup => EF.Property<string>(
                    resourceGroup,
                    "_id"))
                .Select(resourceGroup => EF.Property<string>(
                    resourceGroup,
                    "_id"))
                .Take(take)
                .ToListAsync(queryCancellation);
        }

        return await CreateGroupPage(
            rows.Select(GroupId.FromStorage).ToArray(),
            pageSize,
            cancellation);
    }
}
