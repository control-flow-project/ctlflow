using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class NativeResponses
{
    public static Task Send(HttpContext http, string requestId, int status, JsonElement value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Crossfire.Contracts.ApiJson.Default.JsonElement);
        http.Response.StatusCode = status; http.Response.ContentType = "application/json";
        http.Response.Headers.CacheControl = "no-store"; http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers["X-Request-ID"] = requestId; http.Response.ContentLength = bytes.Length;
        return http.Response.Body.WriteAsync(bytes, http.RequestAborted).AsTask();
    }

    public static Task Error(HttpContext http, string requestId, int status, string code, string message)
        => Send(http, requestId, status, JsonValues.Object(writer => { writer.WriteString("errcode", code); writer.WriteString("error", message); }));

    public static Task Reject(HttpContext http, string requestId, Failure failure)
    {
        var status = failure.Code switch { "unauthorized" => 401, "forbidden" => 403, "body_too_large" => 413, "native" => 502, "unavailable" => 503, _ => 400 };
        return Error(http, requestId, status, status switch { 401 => "M_UNKNOWN_TOKEN", 403 => "M_FORBIDDEN", 413 => "M_TOO_LARGE", >= 500 => "M_UNKNOWN", _ => "M_INVALID_PARAM" }, failure.Message);
    }
}
