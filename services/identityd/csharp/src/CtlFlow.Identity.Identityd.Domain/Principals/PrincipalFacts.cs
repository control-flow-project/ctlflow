using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public sealed record PrincipalFacts(
    PrincipalId PrincipalId,
    PrincipalKind PrincipalKind,
    bool PrincipalEnabled,
    Revision PrincipalRevision,
    AccountId SubjectAccountId,
    bool SubjectAccountEnabled,
    Revision SubjectAccountRevision,
    Revision MembershipRevision);
