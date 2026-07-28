using CtlFlow.Configuration.Configd.Service.Security.Tokens;

namespace CtlFlow.Configuration.Configd.Service.Security.Principals;

internal readonly record struct PrincipalId
{
    private const int MaximumLength = 256;

    private PrincipalId(string value, string kind)
    {
        Value = value;
        Kind = kind;
    }

    internal string Value { get; }

    internal string Kind { get; }

    internal static PrincipalId Parse(string value)
    {
        var separator = value.IndexOf(':');
        if (value.Length is < 3 or > MaximumLength
            || separator <= 0
            || separator == value.Length - 1
            || !IsKind(value.AsSpan(0, separator))
            || !IsIdentifier(value.AsSpan(separator + 1)))
        {
            throw new TokenValidationException();
        }

        return new PrincipalId(value, value[..separator]);
    }

    public override string ToString() => Value;

    private static bool IsKind(ReadOnlySpan<char> value)
    {
        if (!IsLowerAlpha(value[0]))
        {
            return false;
        }

        foreach (var character in value[1..])
        {
            if (!IsLowerAlpha(character) && character != '_')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsIdentifier(ReadOnlySpan<char> value)
    {
        if (!IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value[1..])
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-' and not '.')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlpha(char value) =>
        value is >= 'a' and <= 'z';

    private static bool IsLowerAlphaNumeric(char value) =>
        IsLowerAlpha(value) || value is >= '0' and <= '9';
}
