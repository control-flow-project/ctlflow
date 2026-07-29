namespace CtlFlow.Egress.Egressd.Domain.Bindings;

public sealed record EgressOrigin
{
    private EgressOrigin(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<EgressOrigin> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 9 or > 2_048
            || !HasCanonicalAuthority(value)
            || !Uri.TryCreate(value, UriKind.Absolute, out var origin)
            || origin.Scheme != Uri.UriSchemeHttps
            || Uri.CheckHostName(origin.Host) != UriHostNameType.Dns
            || origin.Port is < 1 or > 65_535
            || origin.AbsolutePath != "/"
            || !string.IsNullOrEmpty(origin.UserInfo)
            || !string.IsNullOrEmpty(origin.Query)
            || !string.IsNullOrEmpty(origin.Fragment))
        {
            throw new ArgumentException(
                "The Egress origin is invalid",
                nameof(value));
        }

        return ValueTask.FromResult(
            new EgressOrigin(origin.GetLeftPart(UriPartial.Authority)));
    }

    private static bool HasCanonicalAuthority(string value)
    {
        const string prefix = "https://";
        if (!value.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var authority = value.AsSpan(prefix.Length);
        if (authority.EndsWith("/", StringComparison.Ordinal))
        {
            authority = authority[..^1];
        }
        var portSeparator = authority.LastIndexOf(':');
        var host = portSeparator < 0
            ? authority
            : authority[..portSeparator];
        if (portSeparator >= 0)
        {
            var port = authority[(portSeparator + 1)..];
            if (port.Length is < 1 or > 5
                || port.ContainsAnyExceptInRange('0', '9'))
            {
                return false;
            }
        }

        var labelLength = 0;
        for (var index = 0; index < host.Length; index++)
        {
            var character = host[index];
            if (character == '.')
            {
                if (labelLength is < 1 or > 63
                    || !IsLowerAlphaNumeric(host[index - 1]))
                {
                    return false;
                }
                labelLength = 0;
                continue;
            }
            if (labelLength == 0 && !IsLowerAlphaNumeric(character)
                || labelLength > 0
                && !IsLowerAlphaNumeric(character)
                && character != '-')
            {
                return false;
            }
            labelLength++;
        }

        return labelLength is >= 1 and <= 63
            && IsLowerAlphaNumeric(host[^1]);
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
