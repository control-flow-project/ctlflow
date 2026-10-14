using System.Text.RegularExpressions;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Http.Features;

namespace Crossfire.Server.Http;

public sealed record RequestTarget(string Raw, string Path, string Decoded, bool Exact);

public static partial class RequestTargets
{
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?register/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Registration();
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?auth/org\.crossfire\.login\.registration/fallback/web/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Fallback();
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?profile/[^/]+/displayname/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Profile();
    [GeneratedRegex(@"^/_matrix/client/v3/profile/[^/]+/displayname$", RegexOptions.CultureInvariant)]
    private static partial Regex ExactProfile();

    public static Result<RequestTarget> Read(HttpContext http, string origin)
    {
        var target = http.Features.Get<IHttpRequestFeature>()?.RawTarget ?? "/";
        if (target.Length > 65536 || target.Any(character => character is <= '\u0020' or '\u007f' or '\\' or '#'))
            return Results.Fail<RequestTarget>("invalid", "Invalid request URL");
        if (!Uri.TryCreate(new Uri(origin), target, out var url) || url.GetLeftPart(UriPartial.Authority) != origin || url.UserInfo.Length != 0)
            return Results.Fail<RequestTarget>("forbidden", "Invalid request host");
        var raw = target.StartsWith('/') && !target.StartsWith("//", StringComparison.Ordinal) ? target : url.PathAndQuery;
        var rawPath = raw.Split('?', 2)[0]; var path = url.AbsolutePath;
        if (rawPath.StartsWith("/_matrix/", StringComparison.Ordinal))
        { var nativePath = Decode(rawPath); if (!nativePath.IsSuccess) return Result<RequestTarget>.Fail(nativePath.Error); }
        var decoded = Decode(path); if (!decoded.IsSuccess) return Result<RequestTarget>.Fail(decoded.Error);
        var exact = rawPath == path;
        if ((Registration().IsMatch(decoded.Value) && (path != RegistrationTransport.RegisterPath || !exact))
            || (Fallback().IsMatch(decoded.Value) && (path != RegistrationTransport.FallbackPath || !exact))
            || (http.Request.Method == "PUT" && Profile().IsMatch(decoded.Value) && (!ExactProfile().IsMatch(path) || !exact)))
            return Results.Fail<RequestTarget>("missing", "Unsupported Matrix identity path");
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
