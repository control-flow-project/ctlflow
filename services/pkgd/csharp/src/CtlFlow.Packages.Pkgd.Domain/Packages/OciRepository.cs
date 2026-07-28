namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record OciRepository
{
    private OciRepository(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<OciRepository> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static OciRepository FromStorage(string value) =>
        Create(value, stored: true);

    private static OciRepository Create(string value, bool stored)
    {
        var slash = value.IndexOf('/');
        if (value.Length is < 3 or > 255
            || slash <= 0
            || slash == value.Length - 1
            || !ValidateHost(value.AsSpan(0, slash))
            || !ValidatePath(value.AsSpan(slash + 1)))
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored OCI repository is not canonical")
                : new ArgumentException("OCI repository is not canonical");
        }

        return new OciRepository(value);
    }

    private static bool ValidateHost(ReadOnlySpan<char> value)
    {
        var colon = value.LastIndexOf(':');
        var host = colon < 0 ? value : value[..colon];
        if (host.Length is < 1 or > 253
            || colon >= 0 && !ValidatePort(value[(colon + 1)..]))
        {
            return false;
        }

        while (true)
        {
            var dot = host.IndexOf('.');
            var label = dot < 0 ? host : host[..dot];
            if (!ValidateDnsLabel(label))
            {
                return false;
            }

            if (dot < 0)
            {
                return true;
            }

            host = host[(dot + 1)..];
        }
    }

    private static bool ValidateDnsLabel(ReadOnlySpan<char> value)
    {
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1]))
        {
            return false;
        }

        foreach (var character in value[1..^1])
        {
            if (!IsLowerAlphaNumeric(character) && character != '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool ValidatePort(ReadOnlySpan<char> value)
    {
        if (value.IsEmpty || value.Length > 1 && value[0] == '0')
        {
            return false;
        }

        var port = 0;
        foreach (var character in value)
        {
            if (character is < '0' or > '9')
            {
                return false;
            }

            if (port > 65_535)
            {
                return false;
            }

            port = port * 10 + character - '0';
        }

        return port is >= 1 and <= 65_535;
    }

    private static bool ValidatePath(ReadOnlySpan<char> value)
    {
        while (true)
        {
            var slash = value.IndexOf('/');
            var segment = slash < 0 ? value : value[..slash];
            if (!ValidatePathSegment(segment))
            {
                return false;
            }

            if (slash < 0)
            {
                return true;
            }

            value = value[(slash + 1)..];
        }
    }

    private static bool ValidatePathSegment(ReadOnlySpan<char> value)
    {
        if (value.IsEmpty || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        var afterSeparator = false;
        foreach (var character in value[1..])
        {
            if (IsLowerAlphaNumeric(character))
            {
                afterSeparator = false;
                continue;
            }

            if (afterSeparator || character is not '.' and not '_' and not '-')
            {
                return false;
            }

            afterSeparator = true;
        }

        return !afterSeparator;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
