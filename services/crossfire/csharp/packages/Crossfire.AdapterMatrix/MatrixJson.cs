using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class MatrixJson
{
    public const string Api = "/_matrix/client/v3";
    public static string Segment(string value) => Uri.EscapeDataString(value).Replace("%21", "!", StringComparison.Ordinal)
        .Replace("%27", "'", StringComparison.Ordinal).Replace("%28", "(", StringComparison.Ordinal)
        .Replace("%29", ")", StringComparison.Ordinal).Replace("%2A", "*", StringComparison.Ordinal);

    public static JsonElement Object(Action<ProtocolWriter> write) => WireJson.Object(write);

    public static string? Text(JsonElement input, string key, int maximum = 255)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(key, out var value)) return null;
        var parsed = Validation.Text(value, maximum);
        return parsed.IsSuccess ? parsed.Value : null;
    }

    public static bool Error(JsonElement input, string code) => Text(input, "errcode", 100) == code;

    public static async ValueTask<Result<JsonElement>> Ok(HttpClient client, NativeEndpoint endpoint, string method, string path,
        JsonElement? body = null, CancellationToken cancellation = default)
    {
        var opened = await NativeHttp.Json(client, endpoint, method, path, body, cancellation: cancellation);
        if (!opened.IsSuccess) return Result<JsonElement>.Fail(opened.Error);
        using var response = opened.Value;
        if (response.Body.ValueKind != JsonValueKind.Object) return Results.Fail<JsonElement>("native", "Expected a native JSON object");
        if (response.Status is < 200 or >= 300)
        {
            var error = Text(response.Body, "errcode", 8192);
            return Results.Fail<JsonElement>("native", "Native HTTP " + response.Status + (error is null ? "" : ": " + error[..Math.Min(error.Length, 80)]));
        }
        return Result<JsonElement>.Success(response.Body.Clone());
    }
}
