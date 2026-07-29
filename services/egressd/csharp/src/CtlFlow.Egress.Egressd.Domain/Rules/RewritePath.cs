namespace CtlFlow.Egress.Egressd.Domain.Rules;

public static partial class Rules
{
    public static ValueTask<string> RewritePath(
        EgressRule rule,
        string path,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var matched = rule.Match.Path.Value;
        var suffix = matched == "/"
            ? path == "/" ? "" : path
            : path[matched.Length..];
        var replacement = rule.UpstreamPathPrefix.Value;
        var rewritten = replacement == "/"
            ? suffix.Length == 0 ? "/" : suffix
            : suffix.Length == 0 ? replacement : $"{replacement}{suffix}";
        return ValueTask.FromResult(rewritten);
    }
}
