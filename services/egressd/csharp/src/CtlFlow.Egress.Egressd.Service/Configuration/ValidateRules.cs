using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static void ValidateRules(
        IReadOnlyList<EgressRule> rules,
        SecretValues secrets)
    {
        var ruleIds = new HashSet<RuleId>();
        for (var left = 0; left < rules.Count; left++)
        {
            var rule = rules[left];
            if (!ruleIds.Add(rule.RuleId))
            {
                throw new InvalidOperationException(
                    "Egressd rule IDs are not unique");
            }

            foreach (var replacement in rule.SetRequestHeaders)
            {
                if (replacement.Value is RequestHeaderValue.Secret secret
                    && !secrets.TryRead(secret.Name, out _))
                {
                    throw new InvalidOperationException(
                        "Egressd rule references an absent secret");
                }
            }

            for (var right = left + 1; right < rules.Count; right++)
            {
                var candidate = rules[right];
                if (rule.Match == candidate.Match
                    && rule.Methods.Overlaps(candidate.Methods))
                {
                    throw new InvalidOperationException(
                        "Egressd rules contain an ambiguous method and path");
                }
            }
        }
    }
}
