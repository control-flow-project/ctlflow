using System.Globalization;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCrossfire;

public static class ListenerControlClient
{
    public static ValueTask<Result<JsonElement>> Request(HttpClient http, string state, JsonElement input, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var file = Path.Combine(state, "listener.json"); if (!PrivateFiles.Exists(file)) return Results.Fail<JsonElement>("unavailable", "The owning listener is not connected; no replacement receiver was started"); var record = WireJson.Parse(PrivateFiles.Read(file, 1048576));
        if (!Validation.Fields(record, ["port", "secret", "binding"]).IsSuccess || !Validation.Integer(record.GetProperty("port"), 1, 65535).IsSuccess || WireJson.Text(record, "secret") is not { Length: 64 } secret || secret.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9')) || WireJson.Text(record, "binding") is not { Length: >= 1 and <= 255 } binding || !binding.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-')) return Results.Fail<JsonElement>("invalid", "Invalid private listener control record");
        var action = WireJson.Text(input, "action"); var origin = "http://127.0.0.1:" + record.GetProperty("port").GetInt32().ToString(CultureInfo.InvariantCulture); var response = await NativeHttp.Json(http, new(origin, secret, action == "status" ? 3000 : 45000), "POST", "/bindings/" + binding + "/control", input, 1048576, cancellation, 65536); if (!response.IsSuccess) return Result<JsonElement>.Fail(response.Error); using var received = response.Value;
        if (action is "read" or "acknowledge")
        {
            var value = received.Body; if (!value.TryGetProperty("ok", out var ok) || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<JsonElement>("invalid", "Invalid listener query response"); if (ok.GetBoolean() && value.TryGetProperty("value", out var data)) return Result<JsonElement>.Success(data.Clone());
            if (value.TryGetProperty("error", out var error) && WireJson.Text(error, "code") is { } code && WireJson.Text(error, "message") is { } message) return Results.Fail<JsonElement>(code, message); return Results.Fail<JsonElement>("invalid", "Invalid listener query failure");
        }
        if (received.Status != 200) return Results.Fail<JsonElement>("unavailable", WireJson.Text(received.Body, "error") ?? "Listener rejected the control request");
        if (!Validation.Fields(received.Body, ["release", "binding", "session", "ready"], ["test"]).IsSuccess || WireJson.Text(received.Body, "binding") != binding || WireJson.Text(received.Body, "release") is null || WireJson.Text(received.Body, "session") is null || !Validation.Boolean(received.Body.GetProperty("ready")).IsSuccess) return Results.Fail<JsonElement>("invalid", "Invalid listener status or different binding"); return Result<JsonElement>.Success(received.Body.Clone());
    });
}
