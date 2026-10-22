using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public static class PublicApplication
{
    private static readonly IReadOnlyDictionary<string, string> Types = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8", [".json"] = "application/json",
        [".svg"] = "image/svg+xml", [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".webp"] = "image/webp", [".ico"] = "image/x-icon",
        [".woff"] = "font/woff", [".woff2"] = "font/woff2", [".ttf"] = "font/ttf", [".wasm"] = "application/wasm", [".mp3"] = "audio/mpeg", [".ogg"] = "audio/ogg"
    };
    public static WebApplication Build(ApiState state, string listen, string web, MessagingHttpFactory messaging, MessagingPublicRoutes backend, Action wake)
    {
        ApiApplication.Initialize(state);
        using (AssetFiles.Open(web, "index.html")) { }
        var api = ApiPipeline.Create(state, ApiApplication.Endpoints(), wake, messaging);
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls(listen);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false; options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); options.Limits.MaxRequestBodySize = 67108864;
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(120);
        });
        var application = builder.Build(); var host = new Uri(state.Configuration.PublicOrigin).Authority;
        application.Run(async http =>
        {
            try
            {
                if (http.Request.Host.Value != host) { http.Response.StatusCode = 403; return; }
                var target = RequestTargets.Read(http, state.Configuration.PublicOrigin);
                if (!target.IsSuccess)
                {
                    http.Response.StatusCode = target.Error.Code == "missing" ? 404 : target.Error.Code == "forbidden" ? 403 : 400;
                    http.Response.Headers.CacheControl = "no-store"; return;
                }
                var path = target.Value.Path;
                if (path.StartsWith("/api/", StringComparison.Ordinal) || path.StartsWith("/onboarding/", StringComparison.Ordinal)) { await api(http); return; }
                var management = path == "/manage" || path.StartsWith("/manage/", StringComparison.Ordinal);
                if (management)
                {
                    http.Response.Headers["Referrer-Policy"] = "no-referrer"; http.Response.Headers.XFrameOptions = "DENY";
                    http.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
                }
                var asset = management ? path.StartsWith("/manage/assets/", StringComparison.Ordinal) ? path[8..] : "/index.html" : path;
                if (management) { if (http.Request.Method is not ("GET" or "HEAD")) { http.Response.StatusCode = 405; return; } await Static(http, web, asset); }
                else await backend(http, path, target.Value.Raw, api, Static);
            }
            catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            { state.Diagnostics.Write("Public request failed: " + error.GetType().Name); if (http.Response.HasStarted) http.Abort(); else http.Response.StatusCode = 503; }
        });
        return application;
    }

    private static async Task Static(HttpContext http, string root, string path)
    {
        var decoded = RequestTargets.Decode(path);
        if (!decoded.IsSuccess) { http.Response.StatusCode = 404; return; }
        var relative = decoded.Value.TrimStart('/'); if (relative.Length == 0 || relative.EndsWith('/')) relative += "index.html";
        FileStream stream;
        try { stream = AssetFiles.Open(root, relative); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { http.Response.StatusCode = 404; return; }
        await using (stream)
        {
            http.Response.ContentLength = stream.Length; http.Response.ContentType = Types.GetValueOrDefault(Path.GetExtension(relative), "application/octet-stream");
            http.Response.Headers.CacheControl = relative.EndsWith(".html", StringComparison.Ordinal) ? "no-cache" : "public, max-age=3600";
            http.Response.Headers.XContentTypeOptions = "nosniff";
            if (http.Request.Method != "HEAD") await stream.CopyToAsync(http.Response.Body, 65536, http.RequestAborted);
        }
    }
}
