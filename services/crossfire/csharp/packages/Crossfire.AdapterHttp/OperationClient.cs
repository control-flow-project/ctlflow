using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterHttp;

public sealed class OperationClient(HttpClient http, string origin, Func<string?> token, IReadOnlyDictionary<string, RestOperation> operations, int timeoutMilliseconds = 45000)
{
    public ValueTask<Result<JsonElement>> Call(RestCall input, CancellationToken cancellation)
        => Operation(input.Operation, input.Parameters, input.Body, null, null, input.Query, cancellation);
    public ValueTask<Result<JsonElement>> Upload(string operation, IReadOnlyDictionary<string, string> parameters, ReadOnlyMemory<byte> body, CancellationToken cancellation)
        => Operation(operation, parameters, null, body, "application/octet-stream", null, cancellation);
    private async ValueTask<Result<JsonElement>> Operation(string operation, IReadOnlyDictionary<string, string> parameters, JsonElement? body, ReadOnlyMemory<byte>? binary, string? contentType, IReadOnlyDictionary<string, string>? query, CancellationToken cancellation)
    {
        if (!operations.TryGetValue(operation, out var contract) || contract.Binary != (binary is not null)) return Results.Fail<JsonElement>("invalid", "Unknown operation or mismatched JSON/binary request");
        var path = Path(contract, parameters, query); if (!path.IsSuccess) return Result<JsonElement>.Fail(path.Error); var credential = token(); if (contract.Authentication != "public" && string.IsNullOrEmpty(credential)) return Results.Fail<JsonElement>("unauthorized", "The selected operation requires its configured identity credential");
        var endpoint = new NativeEndpoint(origin, credential, timeoutMilliseconds);
        var response = binary is { } bytes ? await NativeHttp.Binary(http, endpoint, contract.Method, path.Value, bytes, contentType!, contract.MaximumBodyBytes, 16777216, cancellation)
            : await NativeHttp.Json(http, endpoint, contract.Method, path.Value, body, 16777216, cancellation, contract.MaximumBodyBytes);
        if (!response.IsSuccess) return Result<JsonElement>.Fail(response.Error.Code == "native" ? response.Error with { Code = "unavailable" } : response.Error); using var received = response.Value;
        var input = received.Body;
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("meta", out var meta) || !Metadata(meta, contract.Collection && received.Status == contract.Status)) return Results.Fail<JsonElement>("invalid", "Coordination response has invalid request or pagination metadata");
        if (received.Status != contract.Status)
        {
            if (!Validation.Fields(input, ["error", "meta"]).IsSuccess) return Results.Fail<JsonElement>("invalid", "Coordination returned unexpected failure envelope fields");
            if (!input.TryGetProperty("error", out var error) || error.ValueKind != JsonValueKind.Object || WireJson.Text(error, "code") is not { } code || WireJson.Text(error, "message") is not { } message || code is not ("invalid" or "unauthorized" or "forbidden" or "missing" or "conflict" or "limit" or "native" or "unavailable" or "stale_revision" or "name_collision" or "capacity" or "rate_limit" or "body_too_large" or "method_not_allowed")) return Results.Fail<JsonElement>("invalid", "Coordination returned an invalid failure envelope");
            IReadOnlyDictionary<string, string>? fields = null; if (error.TryGetProperty("fieldErrors", out var fieldErrors))
            { if (fieldErrors.ValueKind != JsonValueKind.Object || fieldErrors.EnumerateObject().Any(value => value.Value.ValueKind != JsonValueKind.String)) return Results.Fail<JsonElement>("invalid", "Invalid coordination field failures"); fields = fieldErrors.EnumerateObject().ToDictionary(value => value.Name, value => value.Value.GetString()!, StringComparer.Ordinal); }
            return Result<JsonElement>.Fail(new(code, message, fields));
        }
        if (!input.TryGetProperty("data", out var data) || contract.Collection && data.ValueKind != JsonValueKind.Array) return Results.Fail<JsonElement>("invalid", "Coordination response does not match its operation envelope");
        if (!Validation.Fields(input, ["data", "meta"]).IsSuccess) return Results.Fail<JsonElement>("invalid", "Coordination returned unexpected success envelope fields");
        if (!contract.Collection) return Result<JsonElement>.Success(data.Clone());
        return Result<JsonElement>.Success(WireJson.Object(writer => { writer.WritePropertyName("items"); data.WriteTo(writer); writer.WritePropertyName("meta"); meta.WriteTo(writer); }));
    }
    private static bool Metadata(JsonElement value, bool collection)
    {
        if (!Validation.Fields(value, ["requestId"], ["page", "pageSize", "totalItems", "totalPages"]).IsSuccess || WireJson.Text(value, "requestId") is not { } id || !Validation.Identifier(id)) return false;
        foreach (var name in new[] { "page", "pageSize", "totalItems", "totalPages" })
        {
            if (!value.TryGetProperty(name, out var item)) { if (collection) return false; continue; }
            if (!Validation.Integer(item, name is "page" or "pageSize" ? 1 : 0, name == "pageSize" ? 100 : Validation.MaxWireInteger).IsSuccess) return false;
        }
        return true;
    }
    private static Result<string> Path(RestOperation operation, IReadOnlyDictionary<string, string> parameters, IReadOnlyDictionary<string, string>? query)
    {
        var used = new HashSet<string>(StringComparer.Ordinal); var parts = operation.Path.Split('/');
        for (var index = 0; index < parts.Length; index++)
        {
            var part = parts[index]; if (!part.StartsWith('{') || !part.EndsWith('}')) continue; var key = part[1..^1]; used.Add(key);
            if (!parameters.TryGetValue(key, out var value) || string.IsNullOrEmpty(value) || value.Length > 4096 || value.Any(character => character is <= '\u001f' or '\u007f')) return Results.Fail<string>("invalid", "Missing or invalid operation path parameter " + key); parts[index] = Uri.EscapeDataString(value);
        }
        if (parameters.Keys.Any(key => !used.Contains(key))) return Results.Fail<string>("invalid", "Unknown operation path parameter");
        var suffix = query is null || query.Count == 0 ? "" : "?" + string.Join('&', query.Select(value => Uri.EscapeDataString(value.Key) + "=" + Uri.EscapeDataString(value.Value)));
        return Result<string>.Success(string.Join('/', parts) + suffix);
    }
}
