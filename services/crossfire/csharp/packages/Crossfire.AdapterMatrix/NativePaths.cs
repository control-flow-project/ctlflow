using System.Text.RegularExpressions;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static partial class NativePaths
{
    public static Result<Unit> Check(string path, string rawTarget, string method)
    {
        var raw = rawTarget.Split('?', 2)[0];
        string decoded;
        try { decoded = Uri.UnescapeDataString(path); } catch (UriFormatException) { return Results.Fail<Unit>("invalid", "Invalid request path encoding"); }
        var exact = raw == path;
        if (Registration().IsMatch(decoded) && (path != RegistrationTransport.RegisterPath || !exact)
            || Fallback().IsMatch(decoded) && (path != RegistrationTransport.FallbackPath || !exact)
            || method == "PUT" && Profile().IsMatch(decoded) && (!ExactProfile().IsMatch(path) || !exact))
            return Results.Fail<Unit>("missing", "Unsupported Matrix identity path");
        return Results.Done();
    }
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?register/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Registration();
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?auth/org\.crossfire\.login\.registration/fallback/web/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Fallback();
    [GeneratedRegex(@"^/_matrix/client/(?:.*/)?profile/[^/]+/displayname/*$", RegexOptions.CultureInvariant)]
    private static partial Regex Profile();
    [GeneratedRegex(@"^/_matrix/client/v3/profile/[^/]+/displayname$", RegexOptions.CultureInvariant)]
    private static partial Regex ExactProfile();
}
