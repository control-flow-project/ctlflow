namespace CtlFlow.Policy.Policyd.Domain.Rules;

internal static partial class RuleMatchKindCodes
{
    internal static int ToStorage(RuleMatchKind value) =>
        value switch
        {
            RuleMatchKind.Exact => 1,
            RuleMatchKind.Subtree => 2,
            _ => throw new InvalidOperationException("Unknown rule match kind")
        };

    internal static RuleMatchKind FromStorage(int value) =>
        value switch
        {
            1 => RuleMatchKind.Exact,
            2 => RuleMatchKind.Subtree,
            _ => throw new InvalidOperationException(
                "Stored rule match kind is invalid")
        };
}
