using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal sealed record PrincipalFacts(
    PrincipalId Principal,
    PrincipalKind Kind,
    bool PrincipalEnabled,
    PrincipalId SubjectAccount,
    bool SubjectAccountEnabled);
