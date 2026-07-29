namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record RulePath
{
    private RulePath(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<RulePath> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 4_096
            || value[0] != '/'
            || value.Length > 1 && value[^1] == '/')
        {
            throw new ArgumentException("Rule path is invalid", nameof(value));
        }

        foreach (var character in value.AsSpan(1))
        {
            if (character is < '!' or > '~'
                || character is '?' or '#' or '\\' or '%')
            {
                throw new ArgumentException(
                    "Rule path is invalid",
                    nameof(value));
            }
        }

        foreach (var segment in value.Split('/'))
        {
            if (segment is "." or "..")
            {
                throw new ArgumentException(
                    "Rule path is invalid",
                    nameof(value));
            }
        }

        return ValueTask.FromResult(new RulePath(value));
    }
}
