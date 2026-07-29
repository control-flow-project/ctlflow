namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record HeaderName
{
    private HeaderName(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<HeaderName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 128)
        {
            throw new ArgumentException(
                "Header name is invalid",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character is >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '!' or '#' or '$' or '%' or '&' or '\''
                or '*' or '+' or '-' or '.' or '^' or '_' or '`'
                or '|' or '~')
            {
                continue;
            }

            throw new ArgumentException(
                "Header name is invalid",
                nameof(value));
        }

        return ValueTask.FromResult(new HeaderName(value));
    }
}
