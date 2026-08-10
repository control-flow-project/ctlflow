using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CtlFlow.Auth.Authd.Domain.Identifiers;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal static partial class ProviderProjections
{
    private const int MaximumProjectionBytes = 4 * 1024 * 1024;

    internal static async Task<ProviderProjection> LoadProviderProjection(
        string providerPath,
        string secretPath,
        CancellationToken cancellation)
    {
        var providerBytes = await ReadProjection(
            providerPath,
            cancellation);
        var secretBytes = await ReadProjection(secretPath, cancellation);
        try
        {
            using var providersDocument = ParseDocument(providerBytes);
            using var secretsDocument = ParseDocument(secretBytes);
            var pending = ParseProviders(providersDocument.RootElement);
            var secrets = ParseSecrets(secretsDocument.RootElement);
            if (pending.Providers.Count != secrets.Count)
            {
                throw new InvalidDataException(
                    "Provider and credential counts differ");
            }

            var providers =
                new Dictionary<string, ProviderRegistration>(
                    pending.Providers.Count,
                    StringComparer.Ordinal);
            foreach (var item in pending.Providers)
            {
                if (!secrets.Remove(
                        item.CredentialReference,
                        out var secret))
                {
                    throw new InvalidDataException(
                        "Provider credential is missing");
                }

                providers.Add(
                    ProviderProjection.CreateKey(
                        item.TenantId.Value,
                        item.ProviderId.Value),
                    new ProviderRegistration(
                        item.TenantId,
                        item.ProviderId,
                        item.ProjectionReference,
                        item.Issuer,
                        item.AuthorizationEndpoint,
                        item.TokenEndpoint,
                        item.UserInfoEndpoint,
                        item.ClientId,
                        item.CredentialReference,
                        item.EgressBinding,
                        item.VerificationKeys,
                        secret));
            }

            if (secrets.Count != 0)
            {
                throw new InvalidDataException(
                    "Unused provider credential is forbidden");
            }

            return new ProviderProjection(
                pending.PublicOrigin,
                providers);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secretBytes);
        }
    }

    private static async Task<byte[]> ReadProjection(
        string path,
        CancellationToken cancellation)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 4_096,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var length = stream.Length;
        if (length is < 1 or > MaximumProjectionBytes)
        {
            throw new InvalidDataException(
                "Provider projection has an invalid size");
        }

        var bytes = new byte[(int)length];
        try
        {
            var read = 0;
            while (read < bytes.Length)
            {
                var count = await stream.ReadAsync(
                    bytes.AsMemory(read),
                    cancellation);
                if (count == 0)
                {
                    break;
                }
                read += count;
            }
            var extra = new byte[1];
            if (read != bytes.Length
                || await stream.ReadAsync(
                    extra,
                    cancellation) != 0)
            {
                throw new InvalidDataException(
                    "Provider projection changed while being read");
            }

            return bytes;
        }
        catch
        {
            CryptographicOperations.ZeroMemory(bytes);
            throw;
        }
    }

    private static JsonDocument ParseDocument(byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith(Encoding.UTF8.Preamble))
        {
            throw new InvalidDataException(
                "Provider projection must not contain a BOM");
        }

        try
        {
            return JsonDocument.Parse(
                bytes,
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 16
                });
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                "Provider projection is invalid JSON",
                exception);
        }
    }

    private static PendingProjection ParseProviders(JsonElement root)
    {
        RequireProperties(
            root,
            ["schema_version", "public_origin", "providers"],
            "provider projection");
        RequireSchemaVersion(root);
        var publicOrigin = ParsePublicOrigin(
            RequireString(root, "public_origin"));
        var providersElement = root.GetProperty("providers");
        if (providersElement.ValueKind != JsonValueKind.Array
            || providersElement.GetArrayLength() is < 1 or > 4_096)
        {
            throw new InvalidDataException(
                "Provider inventory has an invalid size");
        }

        var providers = new List<PendingProvider>(
            providersElement.GetArrayLength());
        var pairs = new HashSet<string>(StringComparer.Ordinal);
        var references = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in providersElement.EnumerateArray())
        {
            var provider = ParseProvider(element);
            if (!pairs.Add(ProviderProjection.CreateKey(
                    provider.TenantId.Value,
                    provider.ProviderId.Value))
                || !references.Add(provider.CredentialReference))
            {
                throw new InvalidDataException(
                    "Provider selection or credential is duplicated");
            }
            providers.Add(provider);
        }

        return new PendingProjection(publicOrigin, providers);
    }

    private static PendingProvider ParseProvider(JsonElement element)
    {
        RequireProperties(
            element,
            [
                "tenant_id",
                "provider_id",
                "configuration_id",
                "configuration_version_id",
                "secret_id",
                "secret_version_id",
                "issuer",
                "authorization_endpoint",
                "token_endpoint",
                "userinfo_endpoint",
                "client_id",
                "credential_ref",
                "egress_binding",
                "verification_keys"
            ],
            "provider");
        var keysElement = element.GetProperty("verification_keys");
        if (keysElement.ValueKind != JsonValueKind.Array
            || keysElement.GetArrayLength() is < 1 or > 8)
        {
            throw new InvalidDataException(
                "Verification-key inventory has an invalid size");
        }

        var keys = new Dictionary<string, OidcVerificationKey>(
            keysElement.GetArrayLength(),
            StringComparer.Ordinal);
        foreach (var keyElement in keysElement.EnumerateArray())
        {
            var key = ParseVerificationKey(keyElement);
            if (!keys.TryAdd(key.KeyId, key))
            {
                throw new InvalidDataException(
                    "Verification key ID is duplicated");
            }
        }

        return new PendingProvider(
            TenantId.Parse(RequireString(element, "tenant_id")),
            ProviderId.Parse(RequireString(element, "provider_id")),
            new ProviderProjectionReference(
                RequireIdentifier(
                    RequireString(element, "configuration_id"),
                    "configuration ID"),
                RequireIdentifier(
                    RequireString(element, "configuration_version_id"),
                    "configuration version ID"),
                RequireIdentifier(
                    RequireString(element, "secret_id"),
                    "secret ID"),
                RequireIdentifier(
                    RequireString(element, "secret_version_id"),
                    "secret version ID")),
            ParseProviderUri(RequireString(element, "issuer")),
            ParseProviderUri(
                RequireString(element, "authorization_endpoint")),
            ParseProviderUri(RequireString(element, "token_endpoint")),
            ParseProviderUri(RequireString(element, "userinfo_endpoint")),
            RequireVisibleAscii(
                RequireString(element, "client_id"),
                256,
                "client ID"),
            RequireIdentifier(
                RequireString(element, "credential_ref"),
                "credential reference"),
            RequireDnsLabel(
                RequireString(element, "egress_binding")),
            keys);
    }

    private static OidcVerificationKey ParseVerificationKey(
        JsonElement element)
    {
        RequireProperties(
            element,
            ["kid", "kty", "use", "alg", "n", "e"],
            "verification key");
        var keyId = RequireVisibleAscii(
            RequireString(element, "kid"),
            128,
            "key ID");
        if (RequireString(element, "kty") != "RSA"
            || RequireString(element, "use") != "sig"
            || RequireString(element, "alg") != "RS256")
        {
            throw new InvalidDataException(
                "Verification-key metadata is unsupported");
        }

        var modulus = DecodeBase64Url(
            RequireString(element, "n"),
            512,
            "RSA modulus");
        var exponent = DecodeBase64Url(
            RequireString(element, "e"),
            4,
            "RSA exponent");
        var bits = GetBitLength(modulus);
        var exponentValue = ReadUInt32(exponent);
        if (bits is < 2_048 or > 4_096
            || exponent.Length > 1 && exponent[0] == 0
            || exponentValue < 3
            || (exponentValue & 1) == 0)
        {
            throw new InvalidDataException(
                "RSA verification key is invalid");
        }

        return new OidcVerificationKey(keyId, modulus, exponent);
    }

    private static Dictionary<string, ClientSecret> ParseSecrets(
        JsonElement root)
    {
        RequireProperties(
            root,
            ["schema_version", "credentials"],
            "credential projection");
        RequireSchemaVersion(root);
        var credentials = root.GetProperty("credentials");
        if (credentials.ValueKind != JsonValueKind.Array
            || credentials.GetArrayLength() is < 1 or > 4_096)
        {
            throw new InvalidDataException(
                "Credential inventory has an invalid size");
        }

        var values = new Dictionary<string, ClientSecret>(
            credentials.GetArrayLength(),
            StringComparer.Ordinal);
        foreach (var element in credentials.EnumerateArray())
        {
            RequireProperties(
                element,
                ["credential_ref", "client_secret"],
                "credential");
            var reference = RequireIdentifier(
                RequireString(element, "credential_ref"),
                "credential reference");
            var secret = new ClientSecret(RequireVisibleAscii(
                RequireString(element, "client_secret"),
                2_048,
                "client secret"));
            if (!values.TryAdd(reference, secret))
            {
                throw new InvalidDataException(
                    "Credential reference is duplicated");
            }
        }

        return values;
    }

    private static void RequireSchemaVersion(JsonElement element)
    {
        var version = element.GetProperty("schema_version");
        if (version.ValueKind != JsonValueKind.Number
            || version.GetRawText() != "1")
        {
            throw new InvalidDataException(
                "Projection schema version is unsupported");
        }
    }

    private static Uri ParsePublicOrigin(string value)
    {
        var uri = ParseProviderUri(value);
        var canonical = $"{uri.Scheme}://{uri.Authority}";
        if (value != canonical || uri.AbsolutePath != "/")
        {
            throw new InvalidDataException(
                "Public origin must be canonical");
        }

        return uri;
    }

    private static Uri ParseProviderUri(string value)
    {
        if (value.Length > 2_048
            || value.Any(character => character > 0x7f)
            || value.Contains('?')
            || value.Contains('#')
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrEmpty(uri.Host)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidDataException(
                "Provider URI is invalid");
        }

        return uri;
    }

    private static string RequireIdentifier(string value, string label)
    {
        try
        {
            return ProviderId.Parse(value).Value;
        }
        catch (ArgumentException exception)
        {
            throw new InvalidDataException(
                $"{label} is invalid",
                exception);
        }
    }

    private static string RequireDnsLabel(string value)
    {
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1])
            || value.Any(character =>
                !IsLowerAlphaNumeric(character) && character != '-'))
        {
            throw new InvalidDataException(
                "Egress binding is invalid");
        }
        return value;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';

    private static string RequireVisibleAscii(
        string value,
        int maximumLength,
        string label)
    {
        if (value.Length is < 1
            || value.Length > maximumLength
            || value.Any(character => character is < ' ' or > '~'))
        {
            throw new InvalidDataException($"{label} is invalid");
        }

        return value;
    }

    private static string RequireString(
        JsonElement element,
        string property)
    {
        var value = element.GetProperty(property);
        return value.ValueKind == JsonValueKind.String
            ? value.GetString()!
            : throw new InvalidDataException(
                $"{property} must be a string");
    }

    private static void RequireProperties(
        JsonElement element,
        string[] expected,
        string label)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"{label} must be an object");
        }

        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!actual.Add(property.Name))
            {
                throw new InvalidDataException(
                    $"{label} contains a duplicate member");
            }
        }

        if (!actual.SetEquals(expected))
        {
            throw new InvalidDataException(
                $"{label} has an invalid member inventory");
        }
    }

    private static byte[] DecodeBase64Url(
        string value,
        int maximumBytes,
        string label)
    {
        if (value.Length == 0
            || value.Any(character =>
                character is not (>= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '_'
                    or '-')))
        {
            throw new InvalidDataException($"{label} is invalid");
        }

        var maximumEncoded = checked((value.Length + 3) / 4 * 3);
        var rented = ArrayPool<byte>.Shared.Rent(maximumEncoded);
        try
        {
            var padded = value
                .Replace('-', '+')
                .Replace('_', '/')
                .PadRight((value.Length + 3) / 4 * 4, '=');
            if (!Convert.TryFromBase64String(
                    padded,
                    rented,
                    out var written)
                || written is < 1
                || written > maximumBytes)
            {
                throw new InvalidDataException($"{label} is invalid");
            }

            var result = rented.AsSpan(0, written).ToArray();
            if (EncodeBase64Url(result) != value)
            {
                throw new InvalidDataException(
                    $"{label} is not canonical");
            }
            return result;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented, clearArray: true);
        }
    }

    private static string EncodeBase64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    private static int GetBitLength(ReadOnlySpan<byte> value)
    {
        var offset = 0;
        while (offset < value.Length && value[offset] == 0)
        {
            offset++;
        }
        if (offset == value.Length)
        {
            return 0;
        }

        return (value.Length - offset - 1) * 8
            + 32 - System.Numerics.BitOperations.LeadingZeroCount(
                value[offset]);
    }

    private static uint ReadUInt32(ReadOnlySpan<byte> value)
    {
        if (value.Length > 4)
        {
            return 0;
        }

        uint result = 0;
        foreach (var item in value)
        {
            result = (result << 8) | item;
        }
        return result;
    }

    private sealed record PendingProjection(
        Uri PublicOrigin,
        IReadOnlyList<PendingProvider> Providers);

    private sealed record PendingProvider(
        TenantId TenantId,
        ProviderId ProviderId,
        ProviderProjectionReference ProjectionReference,
        Uri Issuer,
        Uri AuthorizationEndpoint,
        Uri TokenEndpoint,
        Uri UserInfoEndpoint,
        string ClientId,
        string CredentialReference,
        string EgressBinding,
        IReadOnlyDictionary<string, OidcVerificationKey> VerificationKeys);
}
