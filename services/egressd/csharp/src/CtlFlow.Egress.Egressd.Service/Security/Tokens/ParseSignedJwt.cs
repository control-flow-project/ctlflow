using System.Text;
using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal static partial class JsonWebTokens
{
    private const int MaximumTokenLength = 16 * 1024;

    internal static SignedJwt ParseSignedJwt(string token)
    {
        if (token.Length is < 1 or > MaximumTokenLength)
        {
            throw new TokenValidationException();
        }

        var segments = token.Split('.');
        if (segments.Length != 3
            || segments.Any(segment => segment.Length == 0))
        {
            throw new TokenValidationException();
        }

        try
        {
            using var header = JsonDocument.Parse(
                DecodeBase64Url(segments[0]),
                CreateDocumentOptions());
            RejectDuplicateProperties(header.RootElement);
            if (ReadRequiredString(header.RootElement, "alg") != "RS256"
                || header.RootElement.TryGetProperty("crit", out _))
            {
                throw new TokenValidationException();
            }

            var keyId = ReadRequiredString(header.RootElement, "kid");
            if (keyId.Length is < 1 or > 128)
            {
                throw new TokenValidationException();
            }

            var claims = JsonDocument.Parse(
                DecodeBase64Url(segments[1]),
                CreateDocumentOptions());
            try
            {
                RejectDuplicateProperties(claims.RootElement);
                return new SignedJwt(
                    keyId,
                    Encoding.ASCII.GetBytes(
                        $"{segments[0]}.{segments[1]}"),
                    DecodeBase64Url(segments[2]),
                    claims);
            }
            catch
            {
                claims.Dispose();
                throw;
            }
        }
        catch (Exception exception) when (
            exception is FormatException
                or JsonException
                or DecoderFallbackException)
        {
            throw new TokenValidationException();
        }
    }

    private static JsonDocumentOptions CreateDocumentOptions() =>
        new()
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 16
        };

    private static byte[] DecodeBase64Url(string value)
    {
        if (value.Length % 4 == 1
            || value.Any(character => character is not (
                >= 'A' and <= 'Z'
                or >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '-'
                or '_')))
        {
            throw new FormatException("Invalid base64url value");
        }

        return Convert.FromBase64String(
            value.Replace('-', '+').Replace('_', '/')
            + new string('=', (4 - value.Length % 4) % 4));
    }

    private static void RejectDuplicateProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new TokenValidationException();
                }
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                RejectDuplicateProperties(item);
            }
        }
    }
}
