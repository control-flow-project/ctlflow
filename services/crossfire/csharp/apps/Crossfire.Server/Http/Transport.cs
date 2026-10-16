using System.Buffers;
using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class Transport
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    public const string CookieName = "__Host-crossfire";

    public static string Cookie(HttpRequest request)
    {
        var values = request.Headers.Cookie.ToString().Split(';').Select(value => value.Trim()).Where(value => value.StartsWith(CookieName + "=", StringComparison.Ordinal)).ToArray();
        return values.Length == 1 && Validation.Secret(values[0][(CookieName.Length + 1)..]) ? values[0][(CookieName.Length + 1)..] : "";
    }

    public static void SetCookie(HttpResponse response, string value)
        => response.Headers.Append("Set-Cookie", CookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=" + (value.Length == 0 ? "0" : "28800"));

    public static async ValueTask<Result<JsonElement>> Read(HttpRequest request, int maximum, CancellationToken cancellation)
    {
        if (request.ContentType?.Split(';', 2)[0] != "application/json") return Results.Fail<JsonElement>("invalid", "Expected application/json");
        var body = await ReadBytes(request, maximum, cancellation);
        if (!body.IsSuccess) return Result<JsonElement>.Fail(body.Error);
        try
        {
            using var document = JsonDocument.Parse(Utf8.GetString(body.Value));
            if (!Validation.Json(document.RootElement)) return Results.Fail<JsonElement>("invalid", "Invalid JSON text or structure");
            return Result<JsonElement>.Success(document.RootElement.Clone());
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException) { return Results.Fail<JsonElement>("invalid", "Invalid UTF-8 JSON"); }
    }

    public static async ValueTask<Result<byte[]>> ReadBytes(HttpRequest request, int maximum, CancellationToken cancellation)
    {
        if (request.ContentLength > maximum) return Results.Fail<byte[]>("body_too_large", "Request body exceeds the configured bound");
        var buffer = new ArrayBufferWriter<byte>(Math.Min(maximum + 1, 16384));
        while (true)
        {
            var available = Math.Min(16384, maximum + 1 - buffer.WrittenCount);
            if (available == 0) return Results.Fail<byte[]>("body_too_large", "Request body exceeds the configured bound");
            var count = await request.Body.ReadAsync(buffer.GetMemory(available)[..available], cancellation);
            if (count == 0) break;
            buffer.Advance(count);
            if (buffer.WrittenCount > maximum) return Results.Fail<byte[]>("body_too_large", "Request body exceeds the configured bound");
        }
        return Result<byte[]>.Success(buffer.WrittenSpan.ToArray());
    }

    public static async Task Send(HttpContext http, string requestId, Result<ApiReply> result, int status)
    {
        byte[] bytes = result.IsSuccess
            ? JsonSerializer.SerializeToUtf8Bytes(new ApiResponse(result.Value.Data, result.Value.Pagination ?? new(requestId)), ApiJson.Default.ApiResponse)
            : JsonSerializer.SerializeToUtf8Bytes(new ApiFailure(new(result.Error.Code, result.Error.Message, result.Error.FieldErrors), new(requestId)), ApiJson.Default.ApiFailure);
        if (bytes.Length > 33554432)
        {
            result = Results.Fail<ApiReply>("unavailable", "Response exceeds the finite output bound");
            bytes = JsonSerializer.SerializeToUtf8Bytes(new ApiFailure(new(result.Error.Code, result.Error.Message), new(requestId)), ApiJson.Default.ApiFailure);
        }
        var response = http.Response;
        response.StatusCode = result.IsSuccess ? status : ApiErrors.Status(result.Error.Code);
        response.ContentType = "application/json; charset=utf-8"; response.Headers.CacheControl = "no-store";
        response.Headers.XContentTypeOptions = "nosniff"; response.Headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
        response.Headers["X-Request-ID"] = requestId;
        if (result.IsSuccess && result.Value.SetCookie is not null) SetCookie(response, result.Value.SetCookie);
        response.ContentLength = bytes.Length;
        await response.Body.WriteAsync(bytes, http.RequestAborted);
    }

    public static Result<IReadOnlyDictionary<string, string>> Query(HttpRequest request, IReadOnlyList<string> allowed)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in request.Query)
        {
            if (!allowed.Contains(entry.Key, StringComparer.Ordinal) || entry.Value.Count != 1)
                return Results.Fail<IReadOnlyDictionary<string, string>>("invalid", "Unknown or duplicated query parameters");
            values.Add(entry.Key, entry.Value[0]!);
        }
        return Result<IReadOnlyDictionary<string, string>>.Success(values);
    }

    public static Result<PageRequest> Page(IReadOnlyDictionary<string, string> values)
    {
        var parsed = Pagination.Parse(values);
        return parsed.IsSuccess ? Result<PageRequest>.Success(new(parsed.Value.Page, parsed.Value.PageSize)) : Result<PageRequest>.Fail(parsed.Error);
    }
}
