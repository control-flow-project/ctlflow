using System.Security.Cryptography;
using System.Text.Json;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

internal static partial class JsonWebTokens
{
    private static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(5);

    internal static async ValueTask<CommonTokenClaims> ValidateToken(
        string token,
        TokenValidationSettings settings,
        VerificationKeys keys,
        DateTimeOffset currentTime,
        CancellationToken cancellation)
    {
        using var jwt = ParseSignedJwt(token);
        var key = await keys.ResolveKey(jwt.KeyId, cancellation);

        using var rsa = RSA.Create();
        rsa.ImportParameters(
            new RSAParameters
            {
                Modulus = key.Modulus,
                Exponent = key.Exponent
            });

        if (!rsa.VerifyData(
                jwt.SigningInput,
                jwt.Signature,
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pkcs1))
        {
            throw new TokenValidationException();
        }

        var claims = jwt.Claims;
        if (ReadRequiredString(claims, "iss") != settings.Issuer
            || !HasAudience(claims, settings.Audience))
        {
            throw new TokenValidationException();
        }

        var subject = ReadRequiredString(claims, "sub");
        if (subject.Length is < 1 or > 256)
        {
            throw new TokenValidationException();
        }

        var issuedAt = ReadUnixTime(claims, "iat");
        var notBefore = ReadUnixTime(claims, "nbf");
        var expiresAt = ReadUnixTime(claims, "exp");
        if (issuedAt > currentTime.Add(ClockSkew)
            || notBefore > currentTime.Add(ClockSkew)
            || expiresAt <= currentTime.Subtract(ClockSkew)
            || expiresAt <= issuedAt
            || expiresAt - issuedAt > settings.MaximumLifetime)
        {
            throw new TokenValidationException();
        }

        return new CommonTokenClaims(
            subject,
            issuedAt,
            expiresAt,
            claims.Clone());
    }

    private static DateTimeOffset ReadUnixTime(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.Number
            || !property.TryGetInt64(out var seconds))
        {
            throw new TokenValidationException();
        }

        try
        {
            return DateTimeOffset.FromUnixTimeSeconds(seconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new TokenValidationException();
        }
    }

    private static bool HasAudience(JsonElement claims, string expected)
    {
        if (!claims.TryGetProperty("aud", out var audience))
        {
            return false;
        }

        if (audience.ValueKind == JsonValueKind.String)
        {
            return audience.GetString() == expected;
        }

        if (audience.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var value in audience.EnumerateArray())
        {
            if (value.ValueKind == JsonValueKind.String
                && value.GetString() == expected)
            {
                return true;
            }
        }

        return false;
    }
}
