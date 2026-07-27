using System.Text.Json;
using CtlFlow.Auth.Authd.Service.Egress;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcProtocol
{
    internal static TokenResponse ReadTokenResponse(
        EgressResponse response)
    {
        RequireJsonContentType(response.ContentType);
        try
        {
            var reader = new Utf8JsonReader(
                response.Body,
                new JsonReaderOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 32
                });
            RequireToken(ref reader, JsonTokenType.StartObject);
            var names = new HashSet<string>(StringComparer.Ordinal);
            string? accessToken = null;
            string? tokenType = null;
            string? idToken = null;
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
                    case "access_token":
                        accessToken = ReadString(ref reader);
                        break;
                    case "token_type":
                        tokenType = ReadString(ref reader);
                        break;
                    case "id_token":
                        idToken = ReadString(ref reader);
                        break;
                    default:
                        reader.Skip();
                        break;
                }
            }
            if (reader.TokenType != JsonTokenType.EndObject
                || reader.Read()
                || accessToken is null
                || tokenType is null
                || idToken is null
                || !IsBearerToken(accessToken)
                || !string.Equals(
                    tokenType,
                    "Bearer",
                    StringComparison.OrdinalIgnoreCase)
                || idToken.Length is < 1 or > 16_384
                || idToken.Any(character => character > 0x7f))
            {
                throw new OidcRejectedException();
            }

            return new TokenResponse(
                new AccessToken(accessToken),
                idToken);
        }
        catch (JsonException)
        {
            throw new OidcRejectedException();
        }
        catch (InvalidOperationException)
        {
            throw new OidcRejectedException();
        }
    }

    internal static void RequireJsonContentType(string? value)
    {
        if (value is null)
        {
            throw new OidcRejectedException();
        }
        var segments = value.Split(';');
        if (segments.Length is < 1 or > 2
            || !string.Equals(
                segments[0].Trim(),
                "application/json",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new OidcRejectedException();
        }
        if (segments.Length == 1)
        {
            return;
        }

        var parameter = segments[1].Trim();
        var separator = parameter.IndexOf('=');
        if (separator <= 0
            || !string.Equals(
                parameter[..separator].Trim(),
                "charset",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new OidcRejectedException();
        }
        var charset = parameter[(separator + 1)..].Trim();
        if (charset.Length >= 2
            && charset[0] == '"'
            && charset[^1] == '"')
        {
            charset = charset[1..^1];
        }
        else if (charset.Contains('"'))
        {
            throw new OidcRejectedException();
        }
        if (!string.Equals(
                charset,
                "utf-8",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new OidcRejectedException();
        }
    }

    internal static string ReadString(ref Utf8JsonReader reader) =>
        reader.TokenType == JsonTokenType.String
            ? reader.GetString()!
            : throw new OidcRejectedException();

    internal static void RequireToken(
        ref Utf8JsonReader reader,
        JsonTokenType expected)
    {
        if (!reader.Read() || reader.TokenType != expected)
        {
            throw new OidcRejectedException();
        }
    }

    private static bool IsBearerToken(string value)
    {
        if (value.Length is < 1 or > 8_192)
        {
            return false;
        }
        var padding = false;
        var material = false;
        foreach (var character in value)
        {
            if (character == '=')
            {
                padding = true;
                continue;
            }
            if (padding
                || character is not (>= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '-'
                    or '.'
                    or '_'
                    or '~'
                    or '+'
                    or '/'))
            {
                return false;
            }
            material = true;
        }
        return material;
    }
}
