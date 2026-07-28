using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Decisions;

public sealed record PolicySubjects(
    PrincipalId? Principal,
    IReadOnlyList<GroupId> Groups);
