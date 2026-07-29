using System.Text;
using Microsoft.AspNetCore.Http.Features;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static ValueTask<RequestTarget> ParseRequestTarget(
        HttpRequest request,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var rawTarget =
            request.HttpContext.Features
                .Get<IHttpRequestFeature>()?
                .RawTarget
            ?? $"{request.PathBase}{request.Path}{request.QueryString}";
        if (!rawTarget.StartsWith("/", StringComparison.Ordinal)
            || rawTarget.StartsWith("//", StringComparison.Ordinal)
            || rawTarget.Contains('#', StringComparison.Ordinal))
        {
            throw new InvalidRequestTargetException();
        }

        var queryIndex = rawTarget.IndexOf('?');
        var rawPath = queryIndex < 0
            ? rawTarget
            : rawTarget[..queryIndex];
        var query = queryIndex < 0
            ? ""
            : rawTarget[queryIndex..];
        ValidateEscaping(rawPath, path: true);
        ValidateEscaping(query, path: false);

        string path;
        string decodedQuery;
        try
        {
            path = Uri.UnescapeDataString(rawPath);
            decodedQuery = Uri.UnescapeDataString(query);
        }
        catch (UriFormatException)
        {
            throw new InvalidRequestTargetException();
        }
        if (path.Any(static character => char.IsControl(character))
            || decodedQuery.Any(static character => char.IsControl(character))
            || path.Contains('\\', StringComparison.Ordinal)
            || path.Split('/').Any(segment => segment is "." or ".."))
        {
            throw new InvalidRequestTargetException();
        }

        return ValueTask.FromResult(new RequestTarget(path, query));
    }

    internal static int CalculateTargetBytes(HttpRequest request)
    {
        var rawTarget =
            request.HttpContext.Features
                .Get<IHttpRequestFeature>()?
                .RawTarget
            ?? $"{request.PathBase}{request.Path}{request.QueryString}";
        return Encoding.UTF8.GetByteCount(rawTarget);
    }

    private static void ValidateEscaping(string value, bool path)
    {
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character == '%')
            {
                if (index + 2 >= value.Length
                    || !TryHex(value[index + 1], out var high)
                    || !TryHex(value[index + 2], out var low))
                {
                    throw new InvalidRequestTargetException();
                }
                var decoded = high * 16 + low;
                if (decoded is < 0x20 or 0x7f
                    || path && decoded is 0x2f or 0x5c)
                {
                    throw new InvalidRequestTargetException();
                }
                index += 2;
                continue;
            }
            if (char.IsControl(character)
                || path && character == '\\')
            {
                throw new InvalidRequestTargetException();
            }
        }
    }

    private static bool TryHex(char value, out int decoded)
    {
        decoded = value switch
        {
            >= '0' and <= '9' => value - '0',
            >= 'a' and <= 'f' => value - 'a' + 10,
            >= 'A' and <= 'F' => value - 'A' + 10,
            _ => -1
        };
        return decoded >= 0;
    }
}
