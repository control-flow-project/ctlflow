using CtlFlow.Policy.Policyd.Domain.Paths;

namespace CtlFlow.Policy.Policyd.Domain.Rules;

public static partial class PolicyRules
{
    public static bool Allows(
        ResourcePath resourcePath,
        IEnumerable<PolicyRule> rules)
    {
        foreach (var rule in rules)
        {
            if (rule.MatchKind == RuleMatchKind.Exact
                && resourcePath == rule.BasePath)
            {
                return true;
            }

            if (rule.MatchKind == RuleMatchKind.Subtree
                && (resourcePath == rule.BasePath
                    || resourcePath.Value.StartsWith(
                        $"{rule.BasePath.Value}/",
                        StringComparison.Ordinal)))
            {
                return true;
            }
        }

        return false;
    }
}
