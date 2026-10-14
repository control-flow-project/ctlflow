using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class CodexJson
{
    public static JsonElement Object(Action<ProtocolWriter> write) => WireJson.Object(write);
    public static JsonElement Empty() => Object(_ => { });
    public static Result<JsonElement> ObjectReply(Result<NativeReply> response)
    {
        if (!response.IsSuccess) return Result<JsonElement>.Fail(response.Error);
        if (response.Value.Error is { } error) return Results.Fail<JsonElement>("native", "Codex request failed: " + error.Message);
        return response.Value.Value is { ValueKind: JsonValueKind.Object } value ? Result<JsonElement>.Success(value)
            : Results.Fail<JsonElement>("native", "Invalid native Codex object response");
    }
    public static string? String(JsonElement value, string name)
        => WireJson.Text(value, name);
    public static bool Integer(JsonElement value, out long result)
    {
        result = 0;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || number is < -9007199254740991 or > 9007199254740991 || !double.IsFinite(number) || Math.Truncate(number) != number) return false;
        result = (long)number; return true;
    }
    public static string Identity(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String) return "s:" + ProtocolJson.Unquote(value.GetRawText()).Value;
        return Integer(value, out var number) ? "n:" + number.ToString(System.Globalization.CultureInfo.InvariantCulture) : throw new InvalidDataException("Invalid native request identity");
    }
    public static string DecisionIdentity(JsonElement value)
        => value.ValueKind == JsonValueKind.String ? "[\"string\"," + ProtocolJson.Quote(ProtocolJson.Unquote(value.GetRawText()).Value) + "]"
            : Integer(value, out var number) ? "[\"number\"," + number.ToString(System.Globalization.CultureInfo.InvariantCulture) + "]" : throw new InvalidDataException("Invalid native request identity");
}
