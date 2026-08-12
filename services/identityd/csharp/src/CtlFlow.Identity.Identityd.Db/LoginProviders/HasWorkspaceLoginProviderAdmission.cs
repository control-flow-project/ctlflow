using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<bool> HasWorkspaceLoginProviderAdmission(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        WorkspaceId workspaceId,
        ProviderId providerId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = IdentityDbTelemetry.StartOperation(
            "has_workspace_login_provider_admission");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        return await database.WorkspaceLoginProviderAdmissions
            .AsNoTracking()
            .AnyAsync(admission =>
                EF.Property<string>(admission, "_tenantId") == tenantValue
                && EF.Property<string>(admission, "_workspaceId")
                    == workspaceValue
                && EF.Property<string>(admission, "_providerId")
                    == providerValue,
                queryCancellation);
    }
}
