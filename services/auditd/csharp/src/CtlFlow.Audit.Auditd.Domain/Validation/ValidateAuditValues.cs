namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    internal static void ValidateCanonicalId(
        string value,
        int maximumLength,
        string parameterName)
    {
        if (value.Length is < 1 || value.Length > maximumLength
            || !IsLowerAlphaNumeric(value[0])
            || value.Any(character =>
                !IsLowerAlphaNumeric(character)
                && character is not '_' and not '-'))
        {
            throw new ArgumentException(
                "Canonical identifier is invalid",
                parameterName);
        }
    }

    internal static void ValidatePackageId(
        string value,
        string parameterName)
    {
        if (value.Length is < 1 or > 128
            || !IsLowerAlphaNumeric(value[0])
            || value.Any(character =>
                !IsLowerAlphaNumeric(character)
                && character is not '_' and not '-' and not '.'))
        {
            throw new ArgumentException(
                "Package identifier is invalid",
                parameterName);
        }
    }

    internal static void ValidateEventId(string value)
    {
        if (value.Length != 36
            || !value.StartsWith("evt_", StringComparison.Ordinal)
            || !IsLowerHex(value.AsSpan(4)))
        {
            throw new ArgumentException("Source event identifier is invalid");
        }
    }

    internal static void ValidateTraceId(string value)
    {
        if (value.Length != 32
            || !IsLowerHex(value)
            || IsAllZero(value))
        {
            throw new ArgumentException("Trace identifier is invalid");
        }
    }

    internal static void ValidateSpanId(string value)
    {
        if (value.Length != 16
            || !IsLowerHex(value)
            || IsAllZero(value))
        {
            throw new ArgumentException("Span identifier is invalid");
        }
    }

    internal static void ValidateSessionId(string value)
    {
        if (value.Length != 32 || !IsLowerHex(value))
        {
            throw new ArgumentException("Session identifier is invalid");
        }
    }

    internal static void ValidateExternalLinkId(string value)
    {
        if (value.Length != 36
            || !value.StartsWith("eil_", StringComparison.Ordinal)
            || !IsLowerHex(value.AsSpan(4)))
        {
            throw new ArgumentException(
                "External-link identifier is invalid");
        }
    }

    internal static void ValidateProjectionId(string value)
    {
        if (value.Length != 56
            || !value.StartsWith("prj_", StringComparison.Ordinal)
            || value.AsSpan(4).ContainsAnyExcept(
                "abcdefghijklmnopqrstuvwxyz234567"))
        {
            throw new ArgumentException("Projection identifier is invalid");
        }
    }

    internal static void ValidateDependencyClaimId(string value)
    {
        if (value.Length != 36
            || !value.StartsWith("dpc-", StringComparison.Ordinal)
            || !IsLowerHex(value.AsSpan(4)))
        {
            throw new ArgumentException(
                "Dependency claim identifier is invalid");
        }
    }

    internal static void ValidatePurpose(string value)
    {
        if (value.Length is < 1 or > 64
            || value[0] is < 'a' or > 'z'
            || value[^1] == '_'
            || value.Contains("__", StringComparison.Ordinal)
            || value.Any(character =>
                !IsLowerAlphaNumeric(character) && character != '_'))
        {
            throw new ArgumentException("Purpose is invalid");
        }
    }

    internal static void ValidateOperatorCommonName(string value)
    {
        if (value.Length is < 1 or > 253
            || value.Any(character =>
                char.IsWhiteSpace(character)
                || char.IsControl(character)))
        {
            throw new ArgumentException(
                "Operator common name is invalid");
        }
    }

    internal static void ValidateWorkloadSubject(string value)
    {
        const string prefix = "system:serviceaccount:";
        if (!value.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new ArgumentException("Workload subject is invalid");
        }

        var remainder = value[prefix.Length..];
        var separator = remainder.IndexOf(':');
        if (separator <= 0
            || separator != remainder.LastIndexOf(':')
            || separator == remainder.Length - 1)
        {
            throw new ArgumentException("Workload subject is invalid");
        }

        ValidateDnsLabel(remainder.AsSpan(0, separator));
        ValidateDnsLabel(remainder.AsSpan(separator + 1));
    }

    internal static void ValidatePrincipal(
        string value,
        bool accountOnly,
        bool humanOnly = false)
    {
        if (value.Length > 256)
        {
            throw new ArgumentException("Principal identifier is invalid");
        }

        var separator = value.IndexOf(':');
        if (separator <= 0 || separator == value.Length - 1)
        {
            throw new ArgumentException("Principal identifier is invalid");
        }

        var kind = value.AsSpan(0, separator);
        var localId = value.AsSpan(separator + 1);
        var kindAllowed = humanOnly
            ? kind.SequenceEqual("user")
            : accountOnly
                ? kind.SequenceEqual("user")
                    || kind.SequenceEqual("service")
                : kind.SequenceEqual("user")
                    || kind.SequenceEqual("service")
                    || kind.SequenceEqual("agent");
        if (!kindAllowed
            || !IsLowerAlphaNumeric(localId[0])
            || !IsPrincipalLocalId(localId))
        {
            throw new ArgumentException("Principal identifier is invalid");
        }
    }

    internal static void ValidatePositive(long value, string parameterName)
    {
        if (value <= 0)
        {
            throw new ArgumentOutOfRangeException(parameterName);
        }
    }

    internal static bool IsGlobal(Events.PlacementAuditTarget target) =>
        target.Kind == Events.PlacementTargetKind.Global;

    private static bool IsLowerAlphaNumeric(char character) =>
        character is >= 'a' and <= 'z' or >= '0' and <= '9';

    private static bool IsPrincipalLocalId(ReadOnlySpan<char> value)
    {
        foreach (var character in value)
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-' and not '.')
            {
                return false;
            }
        }

        return true;
    }

    private static void ValidateDnsLabel(ReadOnlySpan<char> value)
    {
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1]))
        {
            throw new ArgumentException("Workload subject is invalid");
        }

        foreach (var character in value)
        {
            if (!IsLowerAlphaNumeric(character) && character != '-')
            {
                throw new ArgumentException("Workload subject is invalid");
            }
        }
    }

    private static bool IsLowerHex(ReadOnlySpan<char> value)
    {
        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'f')
                and not (>= '0' and <= '9'))
            {
                return false;
            }
        }

        return value.Length > 0;
    }

    private static bool IsAllZero(ReadOnlySpan<char> value)
    {
        foreach (var character in value)
        {
            if (character != '0')
            {
                return false;
            }
        }

        return true;
    }
}
