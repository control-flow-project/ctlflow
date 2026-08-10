using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    public static async Task<VirtualPrincipal> GetVirtualPrincipal(
        IdentityDatabase identityDatabase,
        VirtualPrincipalId principalId,
        IdentityTarget fence,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "get_virtual_principal");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var principal = await database.VirtualPrincipals
            .AsNoTracking()
            .Where(candidate => EF.Property<string>(candidate, "_id")
                == principalValue)
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
            .SingleOrDefaultAsync(queryCancellation);
        var mappedPrincipal = principal is null
            ? null
            : new VirtualPrincipal(
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
                principal.Revision);
        return await Domain.Principals.Principals.RequireVirtualPrincipal(
            mappedPrincipal,
            fence,
            cancellation);
    }
}
