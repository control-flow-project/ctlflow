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
    public static async Task<bool> Handle(ApiState state, HttpContext http, string path, string requestId)
    {
        var prefix = "/onboarding/" + state.Release.Identity + "/";
        if (http.Request.Method is "GET" or "HEAD" && path.StartsWith(prefix, StringComparison.Ordinal))
        {
            var name = path[prefix.Length..]; byte[]? bytes = name == "manifest.json" ? Encoding.UTF8.GetBytes(JsonSerializer.Serialize(state.Release.Manifest, ApiJson.Default.JsonElement) + "\n")
                : Releases.ArtifactNames.Contains(name, StringComparer.Ordinal) ? state.Release.Files.GetValueOrDefault(name) : null;
            if (bytes is not null) { await Bytes(http, bytes, name == "manifest.json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "public, max-age=31536000, immutable"); return true; }
        }
        if (path is not ("/onboarding/setup" or "/onboarding/setup.json")) return false;
        if (!ReadMethod(http)) return true;
        var query = Transport.Query(http.Request, ["ownerBackendUserId"]);
        if (!query.IsSuccess || query.Value.Count != 1 || !Validation.UserId(query.Value.GetValueOrDefault("ownerBackendUserId", "")))
        { await Transport.Send(http, requestId, Results.Fail<ApiReply>("invalid", "Exactly one ownerBackendUserId is required"), 200); return true; }
        var ownerId = query.Value["ownerBackendUserId"];
        using (var context = state.Storage.Open())
        {
            var principal = MemberQueries.ByBackendUserId(context, ownerId);
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
