using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Domain.Mutations;

public sealed record IdentityMutation<T>(
    T Value,
    IdentityAdministrationAuditIntent? AuditIntent);
