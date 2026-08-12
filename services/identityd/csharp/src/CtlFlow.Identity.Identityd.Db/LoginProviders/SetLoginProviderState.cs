using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<IdentityMutation<LoginProvider>>
        SetLoginProviderState(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            ProviderId providerId,
            Revision expectedRevision,
            LoginProviderState state,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "set_login_provider_state");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var provider = await database.LoginProviders.SingleOrDefaultAsync(
            candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue,
            queryCancellation);
        var result =
            await Domain.Providers.LoginProviders.SetLoginProviderState(
                provider,
                expectedRevision,
                state,
                audit,
                cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        if (result.Value.State == LoginProviderState.Deleted)
        {
            var admissions = await database.WorkspaceLoginProviderAdmissions
                .Where(candidate =>
                    EF.Property<string>(candidate, "_tenantId")
                        == tenantValue
                    && EF.Property<string>(candidate, "_providerId")
                        == providerValue)
                .ToListAsync(queryCancellation);
            database.WorkspaceLoginProviderAdmissions.RemoveRange(admissions);
        }

        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
