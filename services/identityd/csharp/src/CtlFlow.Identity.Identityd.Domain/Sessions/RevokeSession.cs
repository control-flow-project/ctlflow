using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public static partial class Sessions
{
    public static ValueTask<SessionRevocation> RevokeSession(
        Session session,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (session.RevokedAt is not null)
        {
            return ValueTask.FromResult(
                new SessionRevocation(session, null));
        }

        session.Revoke(audit.OccurredAt);
        return ValueTask.FromResult(new SessionRevocation(
            session,
            new SessionAuditIntent(
                AuditEventId.Generate(),
                SessionAuditAction.Revoked,
                audit.Attribution,
                session.Id,
                session.AccountId,
                session.TenantId,
                session.Revision,
                audit.Correlation,
                audit.OccurredAt)));
    }
}
