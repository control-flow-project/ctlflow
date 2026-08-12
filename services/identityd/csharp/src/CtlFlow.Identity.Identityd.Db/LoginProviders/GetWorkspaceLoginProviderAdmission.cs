using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<WorkspaceLoginProviderAdmission>
        GetWorkspaceLoginProviderAdmission(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            WorkspaceId workspaceId,
            ProviderId providerId,
            CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "get_workspace_login_provider_admission");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var admission = await database.WorkspaceLoginProviderAdmissions
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_workspaceId")
                    == workspaceValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue)
            .Join(
                database.LoginProviders.AsNoTracking(),
                candidate => new
                {
                    TenantId = EF.Property<string>(candidate, "_tenantId"),
                    ProviderId = EF.Property<string>(candidate, "_providerId")
                },
                provider => new
                {
                    TenantId = EF.Property<string>(provider, "_tenantId"),
                    ProviderId = EF.Property<string>(provider, "_providerId")
                },
                (candidate, provider) => new
                {
                    Admission = candidate,
                    Provider = provider
                })
            .Where(row => row.Provider.State != LoginProviderState.Deleted)
            .Select(row => new
            {
                TenantId = EF.Property<string>(row.Admission, "_tenantId"),
                WorkspaceId = EF.Property<string>(
                    row.Admission,
                    "_workspaceId"),
                ProviderId = EF.Property<string>(
                    row.Admission,
                    "_providerId")
            })
            .SingleOrDefaultAsync(queryCancellation);
        var mapped = admission is null
            ? null
            : new WorkspaceLoginProviderAdmission(
                Domain.Tenants.TenantId.FromStorage(admission.TenantId),
                Domain.Workspaces.WorkspaceId.FromStorage(
                    admission.WorkspaceId),
                Domain.Providers.ProviderId.FromStorage(
                    admission.ProviderId));
        return await Domain.Providers.LoginProviders
            .RequireWorkspaceLoginProviderAdmission(
                mapped,
                tenantId,
                workspaceId,
                providerId,
                cancellation);
    }
}
