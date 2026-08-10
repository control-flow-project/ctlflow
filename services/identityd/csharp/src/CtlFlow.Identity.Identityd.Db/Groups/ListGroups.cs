using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    public static async Task<Page<Group>> ListGroups(
        IdentityDatabase identityDatabase,
        IdentityTarget target,
        PageSize pageSize,
        GroupId? afterGroupId,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation("list_groups");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = target.TenantId.Value;
        var workspaceValue = target.WorkspaceId?.Value;
        var afterValue = afterGroupId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var groups = await database.Groups
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string?>(candidate, "_workspaceId")
                    == workspaceValue
                && string.Compare(
                    EF.Property<string>(candidate, "_id"),
                    afterValue) > 0)
            .OrderBy(candidate => EF.Property<string>(candidate, "_id"))
            .Select(candidate => new
            {
                Id = EF.Property<string>(candidate, "_id"),
                TenantId = EF.Property<string>(candidate, "_tenantId"),
                WorkspaceId = EF.Property<string?>(candidate, "_workspaceId")
            })
            .Take(take)
            .ToListAsync(queryCancellation);
        var mappedGroups = groups
            .Select(group => new Group(
                Domain.Groups.GroupId.FromStorage(group.Id),
                Domain.Tenants.TenantId.FromStorage(group.TenantId),
                group.WorkspaceId is null
                    ? null
                    : Domain.Workspaces.WorkspaceId.FromStorage(
                        group.WorkspaceId)))
            .ToArray();
        return await CreatePage(
            mappedGroups,
            pageSize,
            group => group.Id.Value,
            cancellation);
    }
}
