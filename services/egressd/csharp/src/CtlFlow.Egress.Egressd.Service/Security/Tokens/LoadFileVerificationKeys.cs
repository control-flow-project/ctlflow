using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal static partial class JsonWebKeys
{
    private const long MaximumKeySetBytes = 1024 * 1024;

    internal static async Task<VerificationKeys> LoadFileVerificationKeys(
        string path,
        CancellationToken cancellation)
    {
        try
        {
            var file = new FileInfo(path);
            if (!file.Exists || file.Length is <= 0 or > MaximumKeySetBytes)
            {
                throw new InvalidDataException(
                    "The verification-key set has an invalid size");
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
            return new VerificationKeys(ParseKeys(document.RootElement));
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or JsonException
                or InvalidDataException)
        {
            throw new InvalidOperationException(
                "The workload verification-key set is invalid",
                exception);
        }
    }

    private static IReadOnlyDictionary<string, RsaVerificationKey> ParseKeys(
        JsonElement root)
    {
        if (!root.TryGetProperty("keys", out var keyArray)
            || keyArray.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException(
                "The verification-key set has no keys");
        }

        var keys = new Dictionary<string, RsaVerificationKey>(
            StringComparer.Ordinal);
        foreach (var key in keyArray.EnumerateArray())
        {
            if (key.ValueKind != JsonValueKind.Object
                || ReadKeyString(key, "kty") != "RSA"
                || ReadOptionalKeyString(key, "alg") is { } algorithm
                    && algorithm != "RS256"
                || ReadOptionalKeyString(key, "use") is { } use
                    && use != "sig")
            {
                continue;
            }

            var keyId = ReadKeyString(key, "kid");
            if (keyId.Length is < 1 or > 128
                || !keys.TryAdd(
                    keyId,
                    CreateRsaVerificationKey(
                        ReadKeyString(key, "n"),
                        ReadKeyString(key, "e"))))
            {
                throw new InvalidDataException(
                    "The verification-key set contains an invalid key");
            }
        }

        return keys.Count > 0
            ? keys
            : throw new InvalidDataException(
                "The verification-key set has no admitted signing key");
    }

    private static string ReadKeyString(
        JsonElement value,
        string name)
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

    private static string? ReadOptionalKeyString(
        JsonElement value,
        string name) =>
        value.TryGetProperty(name, out var property)
            ? property.ValueKind == JsonValueKind.String
                ? property.GetString()
                : throw new InvalidDataException(
                    "The verification-key set contains an invalid key")
            : null;
}
