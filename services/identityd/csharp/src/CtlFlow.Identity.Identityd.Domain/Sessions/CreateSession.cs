using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Accounts;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public static partial class Sessions
{
    public static ValueTask<SessionCreationResult> CreateSession(
        ExternalIdentityFacts? identity,
        ProviderId providerId,
        SessionCredentialDigest credentialDigest,
        SessionLifetime lifetime,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (identity is null
            || identity.AccountKind != AccountKind.Human
            || !identity.AccountEnabled
            || !identity.ProviderActive
            || identity.LinkTenantId != identity.MembershipTenantId)
        {
            return ValueTask.FromResult<SessionCreationResult>(
                new SessionCreationResult.Unauthenticated());
        }

        var session = new Session(
            SessionId.Generate(),
            credentialDigest,
            identity.AccountId,
            identity.LinkTenantId,
            providerId,
            audit.OccurredAt,
            audit.OccurredAt.Add(lifetime.Value),
            null,
            Revision.Initial());
        return ValueTask.FromResult<SessionCreationResult>(
            new SessionCreationResult.Created(new SessionCreation(
                session,
                new SessionAuditIntent(
                    AuditEventId.Generate(),
                    SessionAuditAction.Created,
                    audit.Attribution,
                    session.Id,
                    session.AccountId,
                    session.TenantId,
                    session.Revision,
                    audit.Correlation,
                    audit.OccurredAt))));
    }
}
