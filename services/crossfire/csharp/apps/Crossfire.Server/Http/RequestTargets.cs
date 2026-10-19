using Crossfire.Kernel;
using Microsoft.AspNetCore.Http.Features;

namespace Crossfire.Server.Http;

public sealed record RequestTarget(string Raw, string Path, string Decoded, bool Exact);

public static class RequestTargets
{
    public static Result<RequestTarget> Read(HttpContext http, string origin)
    {
        var target = http.Features.Get<IHttpRequestFeature>()?.RawTarget ?? "/";
        if (target.Length > 65536 || target.Any(character => character is <= '\u0020' or '\u007f' or '\\' or '#'))
            return Results.Fail<RequestTarget>("invalid", "Invalid request URL");
        if (!Uri.TryCreate(new Uri(origin), target, out var url) || url.GetLeftPart(UriPartial.Authority) != origin || url.UserInfo.Length != 0)
            return Results.Fail<RequestTarget>("forbidden", "Invalid request host");
        var raw = target.StartsWith('/') && !target.StartsWith("//", StringComparison.Ordinal) ? target : url.PathAndQuery;
        var rawPath = raw.Split('?', 2)[0]; var path = url.AbsolutePath;
        var decoded = Decode(path); if (!decoded.IsSuccess) return Result<RequestTarget>.Fail(decoded.Error);
        var exact = rawPath == path;
        return Result<RequestTarget>.Success(new(raw, path, decoded.Value, exact));
    }

    public static Result<string> Decode(string path)
    {
        for (var index = 0; index < path.Length; index++)
        {
            if (path[index] != '%') continue;
            if (index + 2 >= path.Length || !Uri.IsHexDigit(path[index + 1]) || !Uri.IsHexDigit(path[index + 2])) return Results.Fail<string>("invalid", "Invalid request path encoding");
            index += 2;
        }
        try
        {
            var decoded = Uri.UnescapeDataString(path);
            if (decoded.Any(character => character is '\0' or '\\' || char.IsControl(character))) return Results.Fail<string>("invalid", "Invalid request path encoding");
            return Result<string>.Success(decoded);
        }
        catch (UriFormatException) { return Results.Fail<string>("invalid", "Invalid request path encoding"); }
    }
}
