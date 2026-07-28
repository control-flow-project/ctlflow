using System.Text;
using System.Text.Json;

namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

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
            || segments[0].Length == 0
            || segments[1].Length == 0
            || segments[2].Length == 0)
        {
            throw new TokenValidationException();
        }

        try
        {
            var headerBytes = DecodeBase64Url(segments[0]);
            var claimBytes = DecodeBase64Url(segments[1]);
            var signature = DecodeBase64Url(segments[2]);
            using var header = JsonDocument.Parse(
                headerBytes,
                CreateDocumentOptions());
            RejectDuplicatePropertyNames(header.RootElement);
            var algorithm = ReadRequiredString(header.RootElement, "alg");
            var keyId = ReadRequiredString(header.RootElement, "kid");
            if (algorithm != "RS256"
                || keyId.Length is < 1 or > 128
                || header.RootElement.TryGetProperty("crit", out _))
            {
                throw new TokenValidationException();
            }

            var claims = JsonDocument.Parse(
                claimBytes,
                CreateDocumentOptions());
            try
            {
                RejectDuplicatePropertyNames(claims.RootElement);
                return new SignedJwt(
                    algorithm,
                    keyId,
                    Encoding.ASCII.GetBytes($"{segments[0]}.{segments[1]}"),
                    signature,
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
        if (value.Length % 4 == 1)
        {
            throw new FormatException("Invalid base64url length");
        }

        foreach (var character in value)
        {
            if (character is not (
                    >= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '-'
                    or '_'))
            {
                throw new FormatException("Invalid base64url character");
            }
        }

        return Convert.FromBase64String(
            value.Replace('-', '+').Replace('_', '/')
            + new string('=', (4 - value.Length % 4) % 4));
    }

    private static void RejectDuplicatePropertyNames(JsonElement value)
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

                RejectDuplicatePropertyNames(property.Value);
            }

            return;
        }

        if (value.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var item in value.EnumerateArray())
        {
            RejectDuplicatePropertyNames(item);
        }
    }
}
