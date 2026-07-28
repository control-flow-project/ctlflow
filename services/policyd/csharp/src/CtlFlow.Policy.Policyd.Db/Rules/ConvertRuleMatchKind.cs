using CtlFlow.Policy.Policyd.Domain.Rules;

namespace CtlFlow.Policy.Policyd.Db.Rules;

internal static partial class RuleMatchKinds
{
    internal static int ToStorage(RuleMatchKind value) =>
        value switch
        {
            (RuleMatchKind)0 => 0,
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
