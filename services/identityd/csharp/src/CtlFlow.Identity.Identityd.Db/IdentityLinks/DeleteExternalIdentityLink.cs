using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.IdentityLinks;

public static partial class IdentityLinks
{
    public static async Task<IdentityRemoval> DeleteExternalIdentityLink(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        ProviderId providerId,
        ProviderSubject providerSubject,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "delete_external_identity_link");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var subjectValue = providerSubject.Value;
        var queryCancellation = cancellation;
        var existing = await database.ExternalIdentityLinks
            .SingleOrDefaultAsync(
                candidate =>
                    EF.Property<string>(candidate, "_tenantId")
                        == tenantValue
                    && EF.Property<string>(candidate, "_providerId")
                        == providerValue
                    && EF.Property<string>(candidate, "_providerSubject")
                        == subjectValue,
                queryCancellation);
        var result = await Domain.IdentityLinks.ExternalIdentityLinks
            .DeleteExternalIdentityLink(existing, audit, cancellation);
        if (result.AuditIntent is not null)
        {
            database.ExternalIdentityLinks.Remove(existing!);
            await database.SaveChangesAsync(cancellation);
        }

        return result;
    }
}
