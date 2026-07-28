using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Service.Content;

internal static partial class DependencyOptions
{
    private const int MaximumByteLength = 65_536;
    private const int MaximumDepth = 16;

    internal static async ValueTask<DependencyOptionsContent> ParseContent(
        ComponentId componentId,
        DependencyName dependencyName,
        ReadOnlyMemory<byte> canonicalJson,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (canonicalJson.Length < 2)
        {
            throw new ArgumentException(
                "Dependency options must contain a JSON object");
        }

        if (canonicalJson.Length > MaximumByteLength)
        {
            throw new PackageLimitExceededException(
                "Dependency options exceed their byte limit");
        }

        EnsureDepth(canonicalJson.Span);
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(
                canonicalJson,
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = MaximumDepth
                });
        }
        catch (JsonException exception)
        {
            throw new ArgumentException(
                "Dependency options are not valid JSON",
                exception);
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException(
                    "Dependency options must be a JSON object");
            }

            var rendered = new StringBuilder(canonicalJson.Length);
            AppendCanonical(document.RootElement, rendered);
            var normalized = Encoding.UTF8.GetBytes(rendered.ToString());
            if (!canonicalJson.Span.SequenceEqual(normalized))
            {
                throw new ArgumentException(
                    "Dependency options are not RFC 8785 canonical JSON");
            }

            var bytes = canonicalJson.ToArray();
            var digest = Sha256Digest.FromHash(SHA256.HashData(bytes));
            return new DependencyOptionsContent(
                componentId,
                dependencyName,
                DependencyOptionsReference.Create(bytes.Length, digest),
                bytes);
        }
    }

    private static void EnsureDepth(ReadOnlySpan<byte> json)
    {
        var depth = 0;
        var inString = false;
        var escaped = false;
        foreach (var value in json)
        {
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                }
                else if (value == (byte)'\\')
                {
                    escaped = true;
                }
                else if (value == (byte)'"')
                {
                    inString = false;
                }

                continue;
            }

            if (value == (byte)'"')
            {
                inString = true;
            }
            else if (value is (byte)'{' or (byte)'[')
            {
                depth++;
                if (depth > MaximumDepth)
                {
                    throw new PackageLimitExceededException(
                        "Dependency options exceed their nesting limit");
                }
            }
            else if (value is (byte)'}' or (byte)']')
            {
                depth--;
            }
        }
    }

    private static void AppendCanonical(
        JsonElement value,
        StringBuilder output)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                AppendObject(value, output);
                return;
            case JsonValueKind.Array:
                AppendArray(value, output);
                return;
            case JsonValueKind.String:
                AppendString(value.GetString()!, output);
                return;
            case JsonValueKind.Number:
                output.Append(FormatNumber(value.GetRawText()));
                return;
            case JsonValueKind.True:
                output.Append("true");
                return;
            case JsonValueKind.False:
                output.Append("false");
                return;
            case JsonValueKind.Null:
                output.Append("null");
                return;
            default:
                throw new ArgumentException(
                    "Dependency options contain an unsupported JSON value");
        }
    }

    private static void AppendObject(
        JsonElement value,
        StringBuilder output)
    {
        var properties = value.EnumerateObject()
            .Select(property => new KeyValuePair<string, JsonElement>(
                property.Name,
                property.Value))
            .OrderBy(property => property.Key, StringComparer.Ordinal)
            .ToArray();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in properties)
        {
            if (!names.Add(property.Key))
            {
                throw new ArgumentException(
                    "Dependency options contain a duplicate object key");
            }
        }

        output.Append('{');
        for (var index = 0; index < properties.Length; index++)
        {
            if (index != 0)
            {
                output.Append(',');
            }

            AppendString(properties[index].Key, output);
            output.Append(':');
            AppendCanonical(properties[index].Value, output);
        }

        output.Append('}');
    }

    private static void AppendArray(
        JsonElement value,
        StringBuilder output)
    {
        output.Append('[');
        var index = 0;
        foreach (var item in value.EnumerateArray())
        {
            if (index++ != 0)
            {
                output.Append(',');
            }

            AppendCanonical(item, output);
        }

        output.Append(']');
    }

    private static void AppendString(string value, StringBuilder output)
    {
        output.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            switch (character)
            {
                case '"':
                    output.Append("\\\"");
                    break;
                case '\\':
                    output.Append("\\\\");
                    break;
                case '\b':
                    output.Append("\\b");
                    break;
                case '\t':
                    output.Append("\\t");
                    break;
                case '\n':
                    output.Append("\\n");
                    break;
                case '\f':
                    output.Append("\\f");
                    break;
                case '\r':
                    output.Append("\\r");
                    break;
                case < ' ':
                    output.Append("\\u");
                    output.Append(((int)character).ToString(
                        "x4",
                        CultureInfo.InvariantCulture));
                    break;
                default:
                    if (char.IsHighSurrogate(character))
                    {
                        if (index + 1 >= value.Length
                            || !char.IsLowSurrogate(value[index + 1]))
                        {
                            throw new ArgumentException(
                                "Dependency options contain invalid Unicode");
                        }

                        output.Append(character);
                        output.Append(value[++index]);
                    }
                    else if (char.IsLowSurrogate(character))
                    {
                        throw new ArgumentException(
                            "Dependency options contain invalid Unicode");
                    }
                    else
                    {
                        output.Append(character);
                    }

                    break;
            }
        }

        output.Append('"');
    }

    private static string FormatNumber(string source)
    {
        if (!double.TryParse(
                source,
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var value)
            || !double.IsFinite(value))
        {
            throw new ArgumentException(
                "Dependency options contain an unsupported JSON number");
        }

        if (value == 0)
        {
            return "0";
        }

        var negative = value < 0;
        var shortest = Math.Abs(value).ToString(
            "R",
            CultureInfo.InvariantCulture);
        var exponentSeparator = shortest.IndexOfAny('E', 'e');
        var exponent = exponentSeparator < 0
            ? 0
            : int.Parse(
                shortest.AsSpan(exponentSeparator + 1),
                NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture);
        var mantissa = exponentSeparator < 0
            ? shortest
            : shortest[..exponentSeparator];
        var decimalSeparator = mantissa.IndexOf('.');
        var decimalPosition = decimalSeparator < 0
            ? mantissa.Length
            : decimalSeparator;
        var digits = mantissa.Replace(".", "", StringComparison.Ordinal);
        var firstNonZero = 0;
        while (firstNonZero < digits.Length
               && digits[firstNonZero] == '0')
        {
            firstNonZero++;
        }

        digits = digits[firstNonZero..];
        var decimalExponent = decimalPosition - firstNonZero + exponent;
        digits = digits.TrimEnd('0');
        var formatted = FormatDigits(digits, decimalExponent);
        return negative ? "-" + formatted : formatted;
    }

    private static string FormatDigits(string digits, int decimalExponent)
    {
        if (digits.Length <= decimalExponent && decimalExponent <= 21)
        {
            return digits + new string(
                '0',
                decimalExponent - digits.Length);
        }

        if (decimalExponent > 0 && decimalExponent <= 21)
        {
            return digits.Insert(decimalExponent, ".");
        }

        if (decimalExponent > -6 && decimalExponent <= 0)
        {
            return "0."
                + new string('0', -decimalExponent)
                + digits;
        }

        var exponent = decimalExponent - 1;
        var mantissa = digits.Length == 1
            ? digits
            : digits.Insert(1, ".");
        return mantissa
            + "e"
            + (exponent >= 0 ? "+" : "")
            + exponent.ToString(CultureInfo.InvariantCulture);
    }
}
