namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record SemanticVersion
{
    private SemanticVersion(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<SemanticVersion> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static SemanticVersion FromStorage(string value) =>
        Create(value, stored: true);

    private static SemanticVersion Create(string value, bool stored)
    {
        if (value.Length is < 5 or > 128
            || value.Any(character => character is < '!' or > '~'))
        {
            throw CreateException(stored);
        }

        var buildSeparator = value.IndexOf('+');
        if (buildSeparator != value.LastIndexOf('+'))
        {
            throw CreateException(stored);
        }

        var beforeBuild = buildSeparator < 0
            ? value.AsSpan()
            : value.AsSpan(0, buildSeparator);
        if (buildSeparator >= 0
            && !ValidateIdentifiers(
                value.AsSpan(buildSeparator + 1),
                numericLeadingZerosAllowed: true))
        {
            throw CreateException(stored);
        }

        var prereleaseSeparator = beforeBuild.IndexOf('-');
        var core = prereleaseSeparator < 0
            ? beforeBuild
            : beforeBuild[..prereleaseSeparator];
        if (prereleaseSeparator >= 0
            && !ValidateIdentifiers(
                beforeBuild[(prereleaseSeparator + 1)..],
                numericLeadingZerosAllowed: false))
        {
            throw CreateException(stored);
        }

        var firstDot = core.IndexOf('.');
        var lastDot = core.LastIndexOf('.');
        if (firstDot <= 0 || lastDot <= firstDot
            || core[(firstDot + 1)..lastDot].Contains('.')
            || !ValidateNumeric(core[..firstDot])
            || !ValidateNumeric(core[(firstDot + 1)..lastDot])
            || !ValidateNumeric(core[(lastDot + 1)..]))
        {
            throw CreateException(stored);
        }

        return new SemanticVersion(value);
    }

    private static bool ValidateNumeric(ReadOnlySpan<char> value)
    {
        if (value.IsEmpty || value.Length > 1 && value[0] == '0')
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is < '0' or > '9')
            {
                return false;
            }
        }

        return true;
    }

    private static bool ValidateIdentifiers(
        ReadOnlySpan<char> value,
        bool numericLeadingZerosAllowed)
    {
        while (true)
        {
            var separator = value.IndexOf('.');
            var identifier = separator < 0 ? value : value[..separator];
            if (identifier.IsEmpty)
            {
                return false;
            }

            var numeric = true;
            foreach (var character in identifier)
            {
                if (character is >= '0' and <= '9')
                {
                    continue;
                }

                numeric = false;
                if (character is not (>= 'A' and <= 'Z')
                    and not (>= 'a' and <= 'z')
                    && character != '-')
                {
                    return false;
                }
            }

            if (!numericLeadingZerosAllowed
                && numeric
                && identifier.Length > 1
                && identifier[0] == '0')
            {
                return false;
            }

            if (separator < 0)
            {
                return true;
            }

            value = value[(separator + 1)..];
        }
    }

    private static Exception CreateException(bool stored) =>
        stored
            ? new InvalidOperationException(
                "Stored Semantic Version is not canonical")
            : new ArgumentException(
                "Version must be canonical Semantic Version 2.0.0");
}
