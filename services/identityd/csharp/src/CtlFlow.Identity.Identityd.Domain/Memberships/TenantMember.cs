using CtlFlow.Identity.Identityd.Domain.Accounts;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public sealed record TenantMember(
    Account Account,
    TenantMembership Membership);
