using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    public static async Task<Page<GroupMember>> ListGroupMembers(
        IdentityDatabase identityDatabase,
        GroupId groupId,
        IdentityTarget target,
        PageSize pageSize,
        PrincipalId? afterPrincipalId,
        CancellationToken cancellation)
    {
        using var activity =
            IdentityDbTelemetry.StartOperation("list_group_members");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var groupValue = groupId.Value;
        var queryCancellation = cancellation;
        var group = await database.Groups
            .AsNoTracking()
            .Where(candidate => EF.Property<string>(candidate, "_id")
                == groupValue)
            .Select(candidate => new
            {
                Id = EF.Property<string>(candidate, "_id"),
                TenantId = EF.Property<string>(candidate, "_tenantId"),
                WorkspaceId = EF.Property<string?>(candidate, "_workspaceId")
            })
            .SingleOrDefaultAsync(queryCancellation);
        var storedGroup = group is null
            ? null
            : new Group(
                Domain.Groups.GroupId.FromStorage(group.Id),
                Domain.Tenants.TenantId.FromStorage(group.TenantId),
                group.WorkspaceId is null
                    ? null
                    : Domain.Workspaces.WorkspaceId.FromStorage(
                        group.WorkspaceId));
        storedGroup = await Domain.Groups.Groups.RequireGroup(
            storedGroup,
            target,
            cancellation);
        var afterValue = afterPrincipalId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var accountIds = await database.AccountGroupMemberships
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_groupId") == groupValue
                && string.Compare(
                    EF.Property<string>(candidate, "_accountId"),
                    afterValue) > 0)
            .OrderBy(candidate =>
                EF.Property<string>(candidate, "_accountId"))
            .Select(candidate =>
                EF.Property<string>(candidate, "_accountId"))
            .Take(take)
            .ToListAsync(queryCancellation);
        var virtualIds = await database.VirtualPrincipalGroupMemberships
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_groupId") == groupValue
                && string.Compare(
                    EF.Property<string>(candidate, "_principalId"),
                    afterValue) > 0)
            .OrderBy(candidate =>
                EF.Property<string>(candidate, "_principalId"))
            .Select(candidate =>
                EF.Property<string>(candidate, "_principalId"))
            .Take(take)
            .ToListAsync(queryCancellation);
        var ids = accountIds
            .Concat(virtualIds)
            .OrderBy(value => value, StringComparer.Ordinal)
            .Take(take);
        var members = ids.Select(value =>
        {
            var principalId = PrincipalId.FromStorage(value);
            return new GroupMember(
                storedGroup,
                principalId,
                principalId.Kind);
        }).ToArray();
        return await CreatePage(
            members,
            pageSize,
            member => member.PrincipalId.Value,
            cancellation);
    }
}
