using CtlFlow.Identity.Identityd.Db.Principals;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.IdentityLinks;

public static partial class IdentityLinks
{
    public static async Task<IdentityMutation<ExternalIdentityLink>>
        CreateExternalIdentityLink(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            ProviderId providerId,
            ProviderSubject providerSubject,
            AccountId accountId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"external-link:{tenantId.Value}:{providerId.Value}:{providerSubject.Value}",
            cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "create_external_identity_link");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var subjectValue = providerSubject.Value;
        var queryCancellation = cancellation;
        var provider = await database.LoginProviders.SingleOrDefaultAsync(
            candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue,
            queryCancellation);
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
        var account = await PrincipalQueries.LoadPrincipalFacts(
            identityDatabase,
            accountId.Principal,
            new IdentityTarget(tenantId, null),
            cancellation);
        var result = await Domain.IdentityLinks.ExternalIdentityLinks
            .CreateExternalIdentityLink(
                existing,
                provider,
                account,
                tenantId,
                providerId,
                providerSubject,
                accountId,
                audit,
                cancellation);
        if (result.AuditIntent is not null)
        {
            database.ExternalIdentityLinks.Add(result.Value);
            await database.SaveChangesAsync(cancellation);
        }

        return result;
    }
}
