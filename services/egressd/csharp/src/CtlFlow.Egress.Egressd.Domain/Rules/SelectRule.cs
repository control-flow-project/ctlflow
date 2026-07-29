namespace CtlFlow.Egress.Egressd.Domain.Rules;

public static partial class Rules
{
    public static ValueTask<RuleSelection> SelectRule(
        IReadOnlyList<EgressRule> rules,
        EgressMethod method,
        string path,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var pathMatches = rules
            .Where(rule => Matches(rule.Match, path))
            .ToArray();
        var selected = pathMatches
            .Where(rule => rule.Methods.Contains(method))
            .OrderByDescending(rule => rule.Match.Path.Value.Length)
            .ThenByDescending(rule => rule.Match.Kind == PathMatchKind.Exact)
            .ThenBy(rule => rule.RuleId)
            .FirstOrDefault();
        if (selected is not null)
        {
            return ValueTask.FromResult<RuleSelection>(
                new RuleSelection.Selected(selected));
        }

        if (pathMatches.Length == 0)
        {
            return ValueTask.FromResult<RuleSelection>(
                new RuleSelection.Missing());
        }

        var methods = pathMatches
            .SelectMany(rule => rule.Methods)
            .Distinct()
            .Order()
            .ToArray();
        return ValueTask.FromResult<RuleSelection>(
            new RuleSelection.MethodNotAllowed(methods));
    }

    private static bool Matches(PathMatch match, string path)
    {
        if (match.Kind == PathMatchKind.Exact)
        {
            return string.Equals(
                path,
                match.Path.Value,
                StringComparison.Ordinal);
        }

        var prefix = match.Path.Value;
        return prefix == "/"
            || string.Equals(path, prefix, StringComparison.Ordinal)
            || path.StartsWith(
                $"{prefix}/",
                StringComparison.Ordinal);
    }
}
