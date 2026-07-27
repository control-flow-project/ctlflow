using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Service.Configuration;
using static CtlFlow.Auth.Authd.Service.Oidc.OidcEncoding;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcProtocol
{
    internal static ProviderSubject ValidateIdToken(
        ProviderRegistration provider,
        TokenResponse response,
        DateTimeOffset attemptCreatedAt,
        DateTimeOffset currentTime)
    {
        var segments = response.ReadIdToken().Split('.');
        if (segments.Length != 3
            || segments.Any(segment => segment.Length == 0))
        {
            throw new OidcRejectedException();
        }

        var headerBytes = DecodeBase64Url(segments[0], 4 * 1024);
        var claimsBytes = DecodeBase64Url(segments[1], 16 * 1024);
        var signature = DecodeBase64Url(segments[2], 512);
        var keyId = ReadProtectedHeader(headerBytes);
        if (!provider.VerificationKeys.TryGetValue(keyId, out var key))
        {
            throw new OidcRejectedException();
        }

        var signed = Encoding.ASCII.GetBytes(
            $"{segments[0]}.{segments[1]}");
        if (!key.Verify(signed, signature))
        {
            throw new OidcRejectedException();
        }

        return ReadAndValidateClaims(
            claimsBytes,
            provider,
            response.AccessToken,
            attemptCreatedAt,
            currentTime);
    }

    private static string ReadProtectedHeader(ReadOnlySpan<byte> bytes)
    {
        try
        {
            var reader = new Utf8JsonReader(bytes);
            RequireToken(ref reader, JsonTokenType.StartObject);
            var names = new HashSet<string>(StringComparer.Ordinal);
            string? algorithm = null;
            string? keyId = null;
            string? type = null;
            while (reader.Read()
                && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    throw new OidcRejectedException();
                }
                var name = reader.GetString()!;
                if (!names.Add(name) || !reader.Read())
                {
                    throw new OidcRejectedException();
                }
                switch (name)
                {
                    case "alg":
                        algorithm = ReadString(ref reader);
                        break;
                    case "kid":
                        keyId = ReadString(ref reader);
                        break;
                    case "typ":
                        type = ReadString(ref reader);
                        break;
                    default:
                        throw new OidcRejectedException();
                }
            }
            if (reader.TokenType != JsonTokenType.EndObject
                || reader.Read()
                || algorithm != "RS256"
                || keyId is null
                || keyId.Length is < 1 or > 128
                || keyId.Any(character => character is < ' ' or > '~')
                || type is not null && type != "JWT")
            {
                throw new OidcRejectedException();
            }
            return keyId;
        }
        catch (JsonException)
        {
            throw new OidcRejectedException();
        }
    }

    private static ProviderSubject ReadAndValidateClaims(
        ReadOnlySpan<byte> bytes,
        ProviderRegistration provider,
        AccessToken accessToken,
        DateTimeOffset attemptCreatedAt,
        DateTimeOffset currentTime)
    {
        try
        {
            var reader = new Utf8JsonReader(bytes);
            RequireToken(ref reader, JsonTokenType.StartObject);
            var names = new HashSet<string>(StringComparer.Ordinal);
            string? issuer = null;
            string? audience = null;
            string? authorizedParty = null;
            string? subject = null;
            string? accessTokenHash = null;
            long? expiresAt = null;
            long? issuedAt = null;
            long? notBefore = null;
            while (reader.Read()
                && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    throw new OidcRejectedException();
                }
                var name = reader.GetString()!;
                if (!names.Add(name) || !reader.Read())
                {
                    throw new OidcRejectedException();
                }
                switch (name)
                {
                    case "iss":
                        issuer = ReadString(ref reader);
                        break;
                    case "aud":
                        audience = ReadAudience(ref reader);
                        break;
                    case "azp":
                        authorizedParty = ReadString(ref reader);
                        break;
                    case "exp":
                        expiresAt = ReadInteger(ref reader);
                        break;
                    case "iat":
                        issuedAt = ReadInteger(ref reader);
                        break;
                    case "nbf":
                        notBefore = ReadInteger(ref reader);
                        break;
                    case "sub":
                        subject = ReadString(ref reader);
                        break;
                    case "at_hash":
                        accessTokenHash = ReadString(ref reader);
                        break;
                    default:
                        reader.Skip();
                        break;
                }
            }

            var now = currentTime.ToUnixTimeSeconds();
            var created = attemptCreatedAt.ToUnixTimeSeconds();
            if (reader.TokenType != JsonTokenType.EndObject
                || reader.Read()
                || issuer != provider.Issuer.OriginalString
                || audience != provider.ClientId
                || authorizedParty is not null
                    && authorizedParty != provider.ClientId
                || expiresAt is null
                || expiresAt <= now - 60
                || issuedAt is null
                || issuedAt > now + 60
                || issuedAt < created - 60
                || notBefore is not null && notBefore > now + 60
                || subject is null)
            {
                throw new OidcRejectedException();
            }
            var parsedSubject = ProviderSubject.Parse(subject);
            if (accessTokenHash is not null
                && !ValidateAccessTokenHash(
                    accessTokenHash,
                    accessToken))
            {
                throw new OidcRejectedException();
            }
            return parsedSubject;
        }
        catch (Exception exception) when (
            exception is JsonException
                or ArgumentException
                or InvalidOperationException)
        {
            throw new OidcRejectedException();
        }
    }

    private static string ReadAudience(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return reader.GetString()!;
        }
        if (reader.TokenType != JsonTokenType.StartArray
            || !reader.Read()
            || reader.TokenType != JsonTokenType.String)
        {
            throw new OidcRejectedException();
        }
        var value = reader.GetString()!;
        if (!reader.Read() || reader.TokenType != JsonTokenType.EndArray)
        {
            throw new OidcRejectedException();
        }
        return value;
    }

    private static long ReadInteger(ref Utf8JsonReader reader) =>
        reader.TokenType == JsonTokenType.Number
            && reader.TryGetInt64(out var result)
                ? result
                : throw new OidcRejectedException();

    private static bool ValidateAccessTokenHash(
        string expected,
        AccessToken accessToken)
    {
        var material = accessToken.ReadForUserInfo();
        if (material.Any(character => character > 0x7f))
        {
            return false;
        }
        var digest = SHA256.HashData(
            Encoding.ASCII.GetBytes(material));
        var actual = BrowserValues.Encode(digest.AsSpan(0, 16));
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(actual),
            Encoding.ASCII.GetBytes(expected));
    }
}
