using System.Text.Json;
using System.Text.Json.Serialization;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public sealed record ResponseMetadata(string RequestId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Page = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? PageSize = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? TotalItems = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? TotalPages = null);
public sealed record ApiResponse(JsonElement Data, ResponseMetadata Meta);
public sealed record ApiError(string Code, string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, string>? FieldErrors = null);
public sealed record ApiFailure(ApiError Error, ResponseMetadata Meta);
public sealed record PageRequest(int Page, int PageSize)
{
    public int Offset => checked((Page - 1) * PageSize);
}

public static class ApiErrors
{
    public static int Status(string code) => code switch
    {
        "invalid" => 400, "unauthorized" => 401, "forbidden" => 403, "missing" => 404,
        "conflict" or "stale_revision" or "name_collision" or "capacity" => 409,
        "limit" or "body_too_large" => 413, "native" => 502, "unavailable" => 503,
        "rate_limit" => 429, "method_not_allowed" => 405,
        _ => throw new ArgumentOutOfRangeException(nameof(code), "Unknown canonical failure code")
    };
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ApiResponse))]
[JsonSerializable(typeof(ApiFailure))]
[JsonSerializable(typeof(JsonElement))]
public partial class ApiJson : JsonSerializerContext;
