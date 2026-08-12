using CtlFlow.Identity.Identityd.Domain.Accounts;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public sealed record WorkspaceMember(
    Account Account,
    WorkspaceMembership Membership);
