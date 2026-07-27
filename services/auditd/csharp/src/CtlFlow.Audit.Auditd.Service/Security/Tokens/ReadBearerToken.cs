using Grpc.Core;

namespace CtlFlow.Audit.Auditd.Service.Security.Tokens;

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
                    StringComparison.Ordinal))
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
                    StringComparison.Ordinal)
                || header.Value.Length == prefix.Length
                || header.Value.Length - prefix.Length > 16 * 1024
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
