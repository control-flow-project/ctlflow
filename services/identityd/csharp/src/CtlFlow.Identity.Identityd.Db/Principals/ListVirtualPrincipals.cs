using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    public static async Task<Page<VirtualPrincipal>> ListVirtualPrincipals(
        IdentityDatabase identityDatabase,
        IdentityTarget fence,
        PageSize pageSize,
        VirtualPrincipalId? afterPrincipalId,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "list_virtual_principals");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = fence.TenantId.Value;
        var workspaceValue = fence.WorkspaceId?.Value;
        var afterValue = afterPrincipalId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var principals = await database.VirtualPrincipals
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantFenceId")
                    == tenantValue
                && EF.Property<string?>(candidate, "_workspaceFenceId")
                    == workspaceValue
                && string.Compare(
                    EF.Property<string>(candidate, "_id"),
                    afterValue) > 0)
            .OrderBy(candidate => EF.Property<string>(candidate, "_id"))
            .Select(candidate => new
            {
                Id = EF.Property<string>(candidate, "_id"),
                SubjectAccountId = EF.Property<string>(
                    candidate,
                    "_subjectAccountId"),
                TenantFenceId = EF.Property<string>(
                    candidate,
                    "_tenantFenceId"),
                WorkspaceFenceId = EF.Property<string?>(
                    candidate,
                    "_workspaceFenceId"),
                candidate.Enabled,
                candidate.Revision
            })
            .Take(take)
            .ToListAsync(queryCancellation);
        var mappedPrincipals = principals
            .Select(principal => new VirtualPrincipal(
                VirtualPrincipalId.FromStorage(principal.Id),
                Domain.Accounts.AccountId.FromStorage(
                    principal.SubjectAccountId),
                Domain.Tenants.TenantId.FromStorage(
                    principal.TenantFenceId),
                principal.WorkspaceFenceId is null
                    ? null
                    : Domain.Workspaces.WorkspaceId.FromStorage(
                        principal.WorkspaceFenceId),
                principal.Enabled,
                principal.Revision))
            .ToArray();
        return await CreatePage(
            mappedPrincipals,
            pageSize,
            principal => principal.Id.Value,
            cancellation);
    }
}
