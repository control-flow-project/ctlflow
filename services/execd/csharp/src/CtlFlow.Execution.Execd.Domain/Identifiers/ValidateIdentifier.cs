using System.Globalization;
using System.Text;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

internal static class IdentifierValidation
{
    internal static string ExecutionId(string value, string name) =>
        ValidateAsciiIdentifier(value, name, 64, allowDot: false);

    internal static string RunId(string value, string name) =>
        ValidateAsciiIdentifier(value, name, 128, allowDot: true);

    internal static string PackageId(string value, string name) =>
        ValidateAsciiIdentifier(value, name, 128, allowDot: true);

    internal static string PrincipalId(string value, string name)
    {
        if (value.Length is < 3 or > 256 || !value.IsNormalized())
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var separator = value.IndexOf(':');
        if (separator is < 1 || separator == value.Length - 1)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var kind = value.AsSpan(0, separator);
        if (!kind.SequenceEqual("user")
            && !kind.SequenceEqual("service")
            && !kind.SequenceEqual("agent"))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var local = value.AsSpan(separator + 1);
        if (!IsLowerAlphaNumeric(local[0]))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in local)
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '.' and not '_' and not '-')
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string AccountPrincipalId(string value, string name)
    {
        var principal = PrincipalId(value, name);
        if (!principal.StartsWith("user:", StringComparison.Ordinal)
            && !principal.StartsWith("service:", StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"{name} must identify an account",
                name);
        }

        return principal;
    }

    internal static string Purpose(string value, string name)
    {
        if (value.Length is < 1 or > 64 || !IsLowerAlpha(value[0]))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var previousUnderscore = false;
        foreach (var character in value)
        {
            if (character == '_')
            {
                if (previousUnderscore)
                {
                    throw new ArgumentException($"{name} is invalid", name);
                }

                previousUnderscore = true;
                continue;
            }

            if (!IsLowerAlphaNumeric(character))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }

            previousUnderscore = false;
        }

        if (previousUnderscore)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        return value;
    }

    internal static string DependencyName(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)
            || !value.IsNormalized(NormalizationForm.FormC)
            || Encoding.UTF8.GetByteCount(value) > 200)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value)
        {
            if (char.IsControl(character))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string DependencyType(string value, string name)
    {
        if (value.Length is < 1 or > 128)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var segmentStart = true;
        foreach (var character in value)
        {
            if (character == ':')
            {
                if (segmentStart)
                {
                    throw new ArgumentException($"{name} is invalid", name);
                }

                segmentStart = true;
                continue;
            }

            if (segmentStart && !IsLowerAlphaNumeric(character))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }

            if (!IsLowerAlphaNumeric(character)
                && character is not '.' and not '_' and not '-')
            {
                throw new ArgumentException($"{name} is invalid", name);
            }

            segmentStart = false;
        }

        if (segmentStart)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        return value;
    }

    internal static string ConfigId(string value, string name) =>
        ValidateAsciiIdentifier(value, name, 64, allowDot: false);

    internal static string ProjectionId(string value, string name)
    {
        if (value.Length != 56
            || !value.StartsWith("prj_", StringComparison.Ordinal))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value.AsSpan(4))
        {
            if (character is not (>= 'a' and <= 'z')
                and not (>= '2' and <= '7'))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string BindingId(string value, string name)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > 128
            || !value.IsNormalized(NormalizationForm.FormC))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        return value;
    }

    internal static string MountPath(string value, string name)
    {
        if (value.Length is < 2
            || Encoding.UTF8.GetByteCount(value) > 256
            || value[0] != '/'
            || value[^1] == '/'
            || !value.IsNormalized(NormalizationForm.FormC))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        var segments = value.Split('/');
        if (segments.Length < 2 || segments[0].Length != 0)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var segment in segments.AsSpan(1))
        {
            if (segment.Length == 0
                || segment is "." or ".."
                || segment.Any(char.IsControl))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        foreach (var root in new[] { "/dev", "/proc", "/sys", "/run/ctlflow" })
        {
            if (value.Equals(root, StringComparison.Ordinal)
                || value.StartsWith($"{root}/", StringComparison.Ordinal))
            {
                throw new ArgumentException($"{name} uses a reserved root", name);
            }
        }

        return value;
    }

    internal static string ManifestDigest(string value, string name)
    {
        if (value.Length != 71
            || !value.StartsWith("sha256:", StringComparison.Ordinal))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value.AsSpan(7))
        {
            if (!IsLowerHex(character))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string Repository(string value, string name)
    {
        if (value.Length is < 1 or > 255
            || value.Contains("://", StringComparison.Ordinal)
            || value.Contains('@')
            || value.Contains(char.ToUpperInvariant(value[0])))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value)
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '.' and not '_' and not '-' and not '/' and not ':')
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string ContractId(string value, string name)
    {
        if (value.Length is < 1 or > 128)
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var segment in value.Split('.'))
        {
            ValidateAsciiIdentifier(segment, name, 64, allowDot: false);
        }

        return value;
    }

    internal static string EndpointHost(string value, string name)
    {
        if (value.Length is < 1 or > 253
            || Uri.CheckHostName(value) != UriHostNameType.Dns
            || !value.Equals(value.ToLowerInvariant(), StringComparison.Ordinal))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        return value;
    }

    private static string ValidateAsciiIdentifier(
        string value,
        string name,
        int maximum,
        bool allowDot)
    {
        if (value.Length is < 1 || value.Length > maximum
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value)
        {
            if (!IsLowerAlphaNumeric(character)
                && character != '_'
                && character != '-'
                && (!allowDot || character != '.'))
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    private static bool IsLowerAlpha(char value) =>
        value is >= 'a' and <= 'z';

    private static bool IsLowerAlphaNumeric(char value) =>
        IsLowerAlpha(value) || value is >= '0' and <= '9';

    private static bool IsLowerHex(char value) =>
        value is >= '0' and <= '9' or >= 'a' and <= 'f';
}
