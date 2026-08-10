using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<
        IdentityMutation<WorkspaceLoginProviderAdmission?>>
        SetWorkspaceLoginProviderAdmission(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            WorkspaceId workspaceId,
            ProviderId providerId,
            bool admitted,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"workspace-provider:{tenantId.Value}:{workspaceId.Value}:{providerId.Value}",
            cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "set_workspace_login_provider_admission");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var workspaceValue = workspaceId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var provider = await database.LoginProviders.SingleOrDefaultAsync(
            candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue,
            queryCancellation);
        var existing = await database.WorkspaceLoginProviderAdmissions
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_tenantId")
                        == tenantValue
                    && EF.Property<string>(candidate, "_workspaceId")
                        == workspaceValue
                    && EF.Property<string>(candidate, "_providerId")
                        == providerValue,
                queryCancellation);
        var result = await Domain.Providers.LoginProviders
            .SetWorkspaceLoginProviderAdmission(
                provider,
                existing,
                tenantId,
                workspaceId,
                providerId,
                admitted,
                audit,
                cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        if (result.Value is null)
        {
            database.WorkspaceLoginProviderAdmissions.Remove(existing!);
        }
        else
        {
            database.WorkspaceLoginProviderAdmissions.Add(result.Value);
        }

        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
