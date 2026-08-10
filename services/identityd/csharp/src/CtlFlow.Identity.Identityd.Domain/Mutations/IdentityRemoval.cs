using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Domain.Mutations;

public sealed record IdentityRemoval(
    IdentityAdministrationAuditIntent? AuditIntent);
