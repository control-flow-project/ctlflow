using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public sealed record GroupMember(
    Group Group,
    PrincipalId PrincipalId,
    PrincipalKind PrincipalKind);
