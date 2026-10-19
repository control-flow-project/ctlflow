using System.Text.Json;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Crossfire.AdapterMatrix;

public static class NativeWeb
{
    public static Func<HttpContext, string, string, Task<bool>> Create(MatrixWebServices services, JsonElement presentation, Func<HttpContext, Result<Unit>> admission, Action changed)
    {
        var registration = new RegistrationTransport(services);
        return async (http, path, requestId) =>
        {
            var checkedPath = NativePaths.Check(path, http.Features.Get<IHttpRequestFeature>()?.RawTarget ?? path, http.Request.Method);
            if (!checkedPath.IsSuccess) { await NativeResponses.Reject(http, requestId, checkedPath.Error); return true; }
            if (path == "/config.json" || path == "/config." + new Uri(services.PublicOrigin).Host + ".json")
            {
                if (http.Request.Method is not ("GET" or "HEAD")) { http.Response.Headers.Allow = "GET, HEAD"; http.Response.StatusCode = 405; return true; }
                var invitation = services.Invitation(http.Request); var invited = invitation is not null && services.VerifyInvitation(invitation.Id, invitation.Secret).IsSuccess;
                var policy = services.Policy();
                var config = WireJson.Object(writer =>
                {
                    foreach (var name in new[] { "brand", "default_theme" }) { writer.WritePropertyName(name); if (presentation.TryGetProperty(name, out var value)) value.WriteTo(writer); else writer.WriteStringValue(name == "brand" ? "crossfire" : "light"); }
                    foreach (var name in new[] { "branding", "embedded_pages", "setting_defaults" }) if (presentation.TryGetProperty(name, out var value)) { writer.WritePropertyName(name); value.WriteTo(writer); }
                    writer.WriteString("custom_translations_url", "/manage/assets/element-translations.json"); writer.WriteStartObject("default_server_config"); writer.WriteStartObject("m.homeserver"); writer.WriteString("base_url", services.PublicOrigin); writer.WriteString("server_name", services.ServerName); writer.WriteEndObject(); writer.WriteEndObject();
                    foreach (var name in new[] { "disable_custom_urls", "disable_guests", "disable_login_language_selector", "disable_3pid_login" }) writer.WriteBoolean(name, true);
                    writer.WriteBoolean("disable_registration", !invited && !(policy.IsSuccess && policy.Value?.SignupMode == "open")); writer.WriteStartObject("room_directory"); WireJson.Strings(writer, "servers", []); writer.WriteEndObject();
                });
                await NativeResponses.Send(http, requestId, 200, config); return true;
            }
            if (registration.Handles(path))
            {
                if (path == RegistrationTransport.RegisterPath || http.Request.Method == "POST")
                {
                    var admitted = admission(http);
                    if (!admitted.IsSuccess) { if (admitted.Error.Code == "rate_limit") http.Response.Headers.RetryAfter = "60"; await NativeResponses.Error(http, requestId, admitted.Error.Code == "rate_limit" ? 429 : 403, admitted.Error.Code == "rate_limit" ? "M_LIMIT_EXCEEDED" : "M_FORBIDDEN", admitted.Error.Message); return true; }
                }
                await registration.Handle(http, path, requestId); if (http.Request.Method == "POST" && http.Response.StatusCode == 200) changed(); return true;
            }
            if (!MatrixRoutes.Handles(path, http.Request.Method)) return false;
            await MatrixRoutes.Handle(services, http, path, requestId); return true;
        };
    }

    public static async Task Public(HttpContext http, string path, string rawTarget, string origin, string matrixOrigin, string element,
        MatrixProxy proxy, RequestDelegate api, Func<HttpContext, string, string, Task> serve)
    {
        var checkedPath = NativePaths.Check(path, rawTarget, http.Request.Method);
        if (!checkedPath.IsSuccess) { http.Response.StatusCode = checkedPath.Error.Code == "missing" ? 404 : 400; return; }
        if (path == "/config.json" || path == "/config." + new Uri(origin).Host + ".json" || path == RegistrationTransport.RegisterPath || path == RegistrationTransport.FallbackPath || MatrixRoutes.Handles(path, http.Request.Method))
        { await api(http); return; }
        if (path.StartsWith("/_matrix/", StringComparison.Ordinal)) { await proxy.Forward(http, matrixOrigin, new Uri(origin).Authority, rawTarget); return; }
        if (http.Request.Method is not ("GET" or "HEAD")) { http.Response.StatusCode = 405; return; }
        http.Response.Headers["Referrer-Policy"] = "no-referrer"; http.Response.Headers.XFrameOptions = "DENY";
        if (path == "/.well-known/matrix/client")
        { await NativeResponses.Send(http, Identity.Identifier(), 200, WireJson.Object(writer => { writer.WriteStartObject("m.homeserver"); writer.WriteString("base_url", origin); writer.WriteEndObject(); })); return; }
        if (path is "/usercontent/" or "/usercontent/index.html") { http.Response.Headers.Remove("X-Frame-Options"); http.Response.Headers.ContentSecurityPolicy = "frame-ancestors 'self'"; }
        await serve(http, element, path);
    }
}
