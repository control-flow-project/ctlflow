namespace CtlFlow.Policy.Policyd.Domain.Paths;

public readonly record struct ResourcePath
{
    private ResourcePath(
        string value,
        IReadOnlyList<string> segments)
    {
        Value = value;
        Segments = segments;
    }

    public string Value { get; }

    internal IReadOnlyList<string> Segments { get; }

    public static ResourcePath Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 2 or > 512
            || value[0] != '/'
            || value[^1] == '/')
        {
            throw new ArgumentException(
                "Resource path is not canonical",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character is < ' ' or > '~'
                || character is '%' or '?' or '#' or '\\')
            {
                throw new ArgumentException(
                    "Resource path is not canonical",
                    nameof(value));
            }
        }

        var segments = value[1..].Split('/');
        if (segments.Any(segment =>
                segment.Length == 0
                || segment is "." or ".."))
        {
            throw new ArgumentException(
                "Resource path is not canonical",
                nameof(value));
        }

        return new ResourcePath(value, Array.AsReadOnly(segments));
    }

    public static ResourcePath FromStorage(string value) => Parse(value);

    public bool Equals(ResourcePath other) =>
        string.Equals(Value, other.Value, StringComparison.Ordinal);

    public override int GetHashCode() =>
        Value is null
            ? 0
            : StringComparer.Ordinal.GetHashCode(Value);

    public override string ToString() => Value;
}
