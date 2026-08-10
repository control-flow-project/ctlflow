using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<Page<WorkspaceLoginProviderAdmission>>
        ListWorkspaceLoginProviderAdmissions(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            WorkspaceId workspaceId,
            PageSize pageSize,
            ProviderId? afterProviderId,
            CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "list_workspace_login_provider_admissions");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var afterValue = afterProviderId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var admissions = await database.WorkspaceLoginProviderAdmissions
            .AsNoTracking()
            .Where(admission =>
                EF.Property<string>(admission, "_tenantId") == tenantValue
                && EF.Property<string>(admission, "_workspaceId")
                    == workspaceValue
                && string.Compare(
                    EF.Property<string>(admission, "_providerId"),
                    afterValue) > 0)
            .Join(
                database.LoginProviders.AsNoTracking(),
                admission => new
                {
                    TenantId = EF.Property<string>(admission, "_tenantId"),
                    ProviderId = EF.Property<string>(admission, "_providerId")
                },
                provider => new
                {
                    TenantId = EF.Property<string>(provider, "_tenantId"),
                    ProviderId = EF.Property<string>(provider, "_providerId")
                },
                (admission, provider) => new
                {
                    Admission = admission,
                    Provider = provider
                })
            .Where(row => row.Provider.State != LoginProviderState.Deleted)
            .OrderBy(row => EF.Property<string>(
                row.Admission,
                "_providerId"))
            .Select(row => new
            {
                TenantId = EF.Property<string>(
                    row.Admission,
                    "_tenantId"),
                WorkspaceId = EF.Property<string>(
                    row.Admission,
                    "_workspaceId"),
                ProviderId = EF.Property<string>(
                    row.Admission,
                    "_providerId")
            })
            .Take(take)
            .ToListAsync(queryCancellation);
        var mappedAdmissions = admissions
            .Select(admission => new WorkspaceLoginProviderAdmission(
                Domain.Tenants.TenantId.FromStorage(admission.TenantId),
                Domain.Workspaces.WorkspaceId.FromStorage(
                    admission.WorkspaceId),
                Domain.IdentityLinks.ProviderId.FromStorage(
                    admission.ProviderId)))
            .ToArray();
        return await CreatePage(
            mappedAdmissions,
            pageSize,
            admission => admission.ProviderId.Value,
            cancellation);
    }
}
