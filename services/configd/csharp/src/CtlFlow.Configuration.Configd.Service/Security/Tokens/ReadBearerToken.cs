using Grpc.Core;

namespace CtlFlow.Configuration.Configd.Service.Security.Tokens;

internal static partial class RequestTokens
{
    internal static string? ReadBearerToken(
        Metadata headers,
        string headerName,
        bool required)
    {
        string? token = null;

        foreach (var header in headers)
        {
            if (!string.Equals(
                    header.Key,
                    headerName,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (header.IsBinary || token is not null)
            {
                throw new TokenValidationException();
            }

            const string prefix = "Bearer ";
            if (!header.Value.StartsWith(
                    prefix,
                    StringComparison.OrdinalIgnoreCase)
                || header.Value.Length == prefix.Length
                || header.Value[prefix.Length..].Any(char.IsWhiteSpace))
            {
                throw new TokenValidationException();
            }

            token = header.Value[prefix.Length..];
        }

        if (required && token is null)
        {
            throw new TokenValidationException();
        }

        return token;
    }
}
