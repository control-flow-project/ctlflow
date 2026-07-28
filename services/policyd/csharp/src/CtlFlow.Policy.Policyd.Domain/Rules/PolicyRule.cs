using CtlFlow.Policy.Policyd.Domain.Paths;

namespace CtlFlow.Policy.Policyd.Domain.Rules;

public sealed record PolicyRule(
    ResourcePath BasePath,
    RuleMatchKind MatchKind);
