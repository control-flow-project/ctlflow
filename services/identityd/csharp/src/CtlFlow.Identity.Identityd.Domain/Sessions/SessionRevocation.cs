using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public sealed record SessionRevocation(
    Session Session,
    SessionAuditIntent? AuditIntent);
