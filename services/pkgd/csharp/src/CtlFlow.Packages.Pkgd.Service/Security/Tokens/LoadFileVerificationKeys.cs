using System.Text.Json;

namespace CtlFlow.Packages.Pkgd.Service.Security.Tokens;

internal static partial class JsonWebKeys
{
    private const long MaximumKeySetBytes = 1024 * 1024;

    internal static async Task<VerificationKeySnapshot> LoadFileVerificationKeys(
        string path,
        TimeSpan cacheLifetime,
        CancellationToken cancellation)
    {
        try
        {
            var file = new FileInfo(path);
            if (!file.Exists || file.Length is <= 0 or > MaximumKeySetBytes)
            {
                throw new InvalidDataException("The verification-key set has an invalid size");
            }

            await using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var document = await JsonDocument.ParseAsync(
                stream,
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 8
                },
                cancellation);

            var keys = ParseKeys(document.RootElement);
            return new VerificationKeySnapshot(
                keys,
                DateTimeOffset.UtcNow.Add(cacheLifetime));
        }
        catch (TokenValidationException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or JsonException
                or InvalidDataException)
        {
            throw new TokenKeySourceException(exception);
        }
    }

    private static IReadOnlyDictionary<string, RsaVerificationKey> ParseKeys(
        JsonElement root)
    {
        if (!root.TryGetProperty("keys", out var keyArray)
            || keyArray.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("The verification-key set has no keys");
        }

        var keys = new Dictionary<string, RsaVerificationKey>(
            StringComparer.Ordinal);

        foreach (var key in keyArray.EnumerateArray())
        {
            if (key.ValueKind != JsonValueKind.Object
                || ReadString(key, "kty") != "RSA"
                || ReadOptionalString(key, "alg") is { } algorithm
                    && algorithm != "RS256"
                || ReadOptionalString(key, "use") is { } use
                    && use != "sig")
            {
                continue;
            }

            var keyId = ReadString(key, "kid");
            if (keyId.Length is < 1 or > 128
                || !keys.TryAdd(
                    keyId,
                    CreateRsaVerificationKey(
                        ReadString(key, "n"),
                        ReadString(key, "e"))))
            {
                throw new InvalidDataException(
                    "The verification-key set contains an invalid key");
            }
        }

        if (keys.Count == 0)
        {
            throw new InvalidDataException(
                "The verification-key set contains no admitted RSA signing key");
        }

        return keys;
    }

    private static string ReadString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.String
            || property.GetString() is not { } result)
        {
            throw new InvalidDataException(
                "The verification-key set contains an invalid key");
        }

        return result;
    }

    private static string? ReadOptionalString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property))
        {
            return null;
        }

        return property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : throw new InvalidDataException(
                "The verification-key set contains an invalid key");
    }

}
