using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public sealed record ExternalIdentityFacts(
    AccountId AccountId,
    AccountKind AccountKind,
    bool AccountEnabled,
    bool ProviderActive,
    TenantId LinkTenantId,
    TenantId MembershipTenantId);
