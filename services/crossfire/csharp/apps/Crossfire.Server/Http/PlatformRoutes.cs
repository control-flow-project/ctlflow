using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class PlatformRoutes
{
    public static async Task<bool> Handle(ApiState state, HttpContext http, string path, string requestId, JsonElement? presentation)
    {
        if (path == "/config.json" || path == "/config." + new Uri(state.Configuration.PublicOrigin).Host + ".json")
        {
            if (!ReadMethod(http)) return true;
            using var context = new CrossfireDbContext(state.Database);
            var claim = InvitationCookies.Read(http.Request);
            var invited = claim is not null && Invitations.Verify(InvitationCommands.Ports(context, state.Now), claim.Id, claim.Secret).IsSuccess;
            var policy = PolicyQueries.Find(context);
            await Json(http, JsonValues.Object(writer =>
            {
                var shown = presentation ?? JsonValues.Object(_ => { });
                foreach (var name in new[] { "brand", "default_theme" })
                {
                    writer.WritePropertyName(name);
                    if (shown.TryGetProperty(name, out var value)) value.WriteTo(writer); else writer.WriteStringValue(name == "brand" ? "Crossfire" : "light");
                }
                foreach (var name in new[] { "branding", "embedded_pages", "setting_defaults" })
                    if (shown.TryGetProperty(name, out var value)) { writer.WritePropertyName(name); value.WriteTo(writer); }
                writer.WriteString("custom_translations_url", "/manage/assets/element-translations.json");
                writer.WriteStartObject("default_server_config"); writer.WriteStartObject("m.homeserver"); writer.WriteString("base_url", state.Configuration.PublicOrigin); writer.WriteString("server_name", state.Configuration.ServerName); writer.WriteEndObject(); writer.WriteEndObject();
                foreach (var name in new[] { "disable_custom_urls", "disable_guests", "disable_login_language_selector", "disable_3pid_login" }) writer.WriteBoolean(name, true);
                writer.WriteBoolean("disable_registration", !invited && !(policy.IsSuccess && policy.Value?.SignupMode == "open"));
                writer.WriteStartObject("room_directory"); JsonValues.Strings(writer, "servers", []); writer.WriteEndObject();
            })); return true;
        }
        var prefix = "/onboarding/" + state.Release.Identity + "/";
        if (http.Request.Method is "GET" or "HEAD" && path.StartsWith(prefix, StringComparison.Ordinal))
        {
            var name = path[prefix.Length..]; byte[]? bytes = name == "manifest.json" ? Encoding.UTF8.GetBytes(JsonSerializer.Serialize(state.Release.Manifest, ApiJson.Default.JsonElement) + "\n")
                : Releases.ArtifactNames.Contains(name, StringComparer.Ordinal) ? state.Release.Files.GetValueOrDefault(name) : null;
            if (bytes is not null) { await Bytes(http, bytes, name == "manifest.json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "public, max-age=31536000, immutable"); return true; }
        }
        if (path is not ("/onboarding/setup" or "/onboarding/setup.json")) return false;
        if (!ReadMethod(http)) return true;
        var query = Transport.Query(http.Request, ["ownerMatrixId"]);
        if (!query.IsSuccess || query.Value.Count != 1 || !Validation.UserId(query.Value.GetValueOrDefault("ownerMatrixId", "")))
        { await Transport.Send(http, requestId, Results.Fail<ApiReply>("invalid", "Exactly one ownerMatrixId is required"), 200); return true; }
        var ownerId = query.Value["ownerMatrixId"];
        using (var context = new CrossfireDbContext(state.Database))
        {
            var principal = MemberQueries.ByMatrixId(context, ownerId);
            if (!principal.IsSuccess) { await Transport.Send(http, requestId, Result<ApiReply>.Fail(principal.Error), 200); return true; }
            if (principal.Value is null || principal.Value.Kind != "human" || principal.Value.Status != "active")
            { await Transport.Send(http, requestId, Results.Fail<ApiReply>("forbidden", "An active registered human owner is required"), 200); return true; }
            var policy = PolicyQueries.Find(context);
            if (!policy.IsSuccess || policy.Value is null) { await Transport.Send(http, requestId, Results.Fail<ApiReply>("unavailable", "Onboarding policy unavailable"), 200); return true; }
            if (path.EndsWith(".json", StringComparison.Ordinal)) await Json(http, Onboarding.Descriptor(state.Configuration.PublicOrigin, ownerId, state.Release.Version, policy.Value.AgentInstructions));
            else await Bytes(http, Encoding.UTF8.GetBytes(Onboarding.Guide(state.Configuration.PublicOrigin, ownerId, state.Release.Version, policy.Value.AgentInstructions)), "text/plain; charset=utf-8");
        }
        return true;
    }
    private static bool ReadMethod(HttpContext http)
    {
        if (http.Request.Method is "GET" or "HEAD") return true;
        http.Response.Headers.Allow = "GET, HEAD"; http.Response.StatusCode = 405; return false;
    }
    public static Task Json(HttpContext http, JsonElement value)
        => Bytes(http, JsonSerializer.SerializeToUtf8Bytes(value, ApiJson.Default.JsonElement), "application/json; charset=utf-8");
    public static async Task Bytes(HttpContext http, byte[] bytes, string type, string cache = "no-store")
    {
        http.Response.ContentType = type; http.Response.ContentLength = bytes.Length; http.Response.Headers.CacheControl = cache;
        http.Response.Headers.XContentTypeOptions = "nosniff"; http.Response.Headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
        if (http.Request.Method != "HEAD") await http.Response.Body.WriteAsync(bytes, http.RequestAborted);
    }
}
