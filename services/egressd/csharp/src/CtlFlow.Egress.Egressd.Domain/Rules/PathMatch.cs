namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record PathMatch(
    PathMatchKind Kind,
    RulePath Path);
