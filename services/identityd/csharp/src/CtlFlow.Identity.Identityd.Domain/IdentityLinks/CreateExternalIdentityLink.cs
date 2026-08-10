using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public static partial class ExternalIdentityLinks
{
    public static ValueTask<IdentityMutation<ExternalIdentityLink>>
        CreateExternalIdentityLink(
            ExternalIdentityLink? existing,
            LoginProvider? provider,
            PrincipalFacts? account,
            TenantId tenantId,
            ProviderId providerId,
            ProviderSubject providerSubject,
            AccountId accountId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provider is null
            || provider.TenantId != tenantId
            || provider.State == LoginProviderState.Deleted)
        {
            throw new IdentityPreconditionException();
        }

        if (account is null
            || account.PrincipalKind != PrincipalKind.Human
            || account.SubjectAccountId != accountId
            || !account.SubjectAccountEnabled)
        {
            throw new IdentityPreconditionException();
        }

        if (existing is not null)
        {
            if (existing.AccountId != accountId)
            {
                throw new IdentityAlreadyExistsException();
            }

            return ValueTask.FromResult(
                new IdentityMutation<ExternalIdentityLink>(existing, null));
        }

        var link = new ExternalIdentityLink(
            tenantId,
            providerId,
            providerSubject,
            accountId,
            Revision.Initial());
        return ValueTask.FromResult(
            new IdentityMutation<ExternalIdentityLink>(
                link,
                new ExternalLinkAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    tenantId,
                    providerId,
                    accountId,
                    ExternalLinkAuditAction.Created,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
