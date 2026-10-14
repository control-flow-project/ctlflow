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
    public static WebApplication Build(ApiState state, string listen, string web, string element, MatrixProxy matrix, Action wake)
    {
        ApiApplication.Initialize(state);
        using (AssetFiles.Open(web, "index.html")) { }
        using (AssetFiles.Open(element, "index.html")) { }
        var presentation = ElementPresentation.Read(element, state.Configuration.PublicOrigin);
        var api = ApiPipeline.Create(state, ApiApplication.Endpoints(), wake, presentation);
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
                if (Managed(path, http.Request.Method, state.Configuration.PublicOrigin)) { await api(http); return; }
                if (path.StartsWith("/_matrix/", StringComparison.Ordinal)) { await matrix.Forward(http, state.Configuration.MatrixOrigin, host, target.Value.Raw); return; }
                if (http.Request.Method is not ("GET" or "HEAD")) { http.Response.StatusCode = 405; return; }
                http.Response.Headers["Referrer-Policy"] = "no-referrer"; http.Response.Headers.XFrameOptions = "DENY";
                if (path == "/.well-known/matrix/client")
                {
                    var body = JsonValues.Object(writer => { writer.WriteStartObject("m.homeserver"); writer.WriteString("base_url", state.Configuration.PublicOrigin); writer.WriteEndObject(); });
                    await PlatformRoutes.Json(http, body); return;
                }
                var management = path == "/manage" || path.StartsWith("/manage/", StringComparison.Ordinal);
                if (management) http.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
                else if (path is "/usercontent/" or "/usercontent/index.html") { http.Response.Headers.Remove("X-Frame-Options"); http.Response.Headers.ContentSecurityPolicy = "frame-ancestors 'self'"; }
                var asset = management ? path.StartsWith("/manage/assets/", StringComparison.Ordinal) ? path[8..] : "/index.html" : path;
                await Static(http, management ? web : element, asset);
            }
            catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            { state.Diagnostics.Write("Public request failed: " + error.GetType().Name); if (http.Response.HasStarted) http.Abort(); else http.Response.StatusCode = 503; }
        });
        return application;
    }

    private static bool Managed(string path, string method, string origin)
        => path.StartsWith("/api/", StringComparison.Ordinal) || path.StartsWith("/onboarding/", StringComparison.Ordinal) || path == "/config.json"
            || path == "/config." + new Uri(origin).Host + ".json" || path == RegistrationTransport.RegisterPath || path == RegistrationTransport.FallbackPath
            || MatrixRoutes.Handles(path, method);

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
