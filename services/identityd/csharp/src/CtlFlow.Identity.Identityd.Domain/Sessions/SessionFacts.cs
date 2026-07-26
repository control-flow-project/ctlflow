using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public sealed record SessionFacts(
    SessionId Id,
    AccountId AccountId,
    TenantId TenantId,
    UtcInstant ExpiresAt,
    UtcInstant? RevokedAt,
    Revision Revision);
