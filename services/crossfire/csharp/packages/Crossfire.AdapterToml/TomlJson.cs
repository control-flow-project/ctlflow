using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AdapterToml;

public static class TomlJson
{
    public static Result<JsonElement> Parse(string text)
    {
        var parsed = ConfigurationToml.Parse(text); if (!parsed.IsSuccess) return Result<JsonElement>.Fail(parsed.Error);
        try { return Result<JsonElement>.Success(WireJson.Build(writer => Write(writer, parsed.Value))); } catch (Exception error) when (error is InvalidDataException or ArgumentException) { return Results.Fail<JsonElement>("invalid", "TOML cannot be represented by the declared JSON configuration contract: " + error.Message); }
    }
    private static void Write(ProtocolWriter writer, object? value)
    {
        switch (value)
        {
            case null: writer.WriteNullValue(); break;
            case string text: writer.WriteStringValue(text); break;
            case bool boolean: writer.WriteBooleanValue(boolean); break;
            case long integer: writer.WriteNumberValue(integer); break;
            case ulong integer: writer.WriteNumberValue(integer); break;
            case int integer: writer.WriteNumberValue(integer); break;
            case uint integer: writer.WriteNumberValue(integer); break;
            case double number when double.IsFinite(number): writer.WriteNumberValue(number); break;
            case float number when float.IsFinite(number): writer.WriteNumberValue(number); break;
            case decimal number: writer.WriteNumberValue(number); break;
            case Dictionary<string, object?> table: writer.WriteStartObject(); foreach (var pair in table) { writer.WritePropertyName(pair.Key); Write(writer, pair.Value); } writer.WriteEndObject(); break;
            case object?[] array: writer.WriteStartArray(); foreach (var item in array) Write(writer, item); writer.WriteEndArray(); break;
            default: throw new InvalidDataException("Configuration contains a non-JSON native TOML value");
        }
    }
    public static Result<string> Format(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) return Results.Fail<string>("invalid", "TOML requires an object root");
        try { return ConfigurationToml.Format((Dictionary<string, object?>)Value(value)!); } catch (InvalidDataException error) { return Results.Fail<string>("invalid", error.Message); }
    }
    private static object? Value(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().ToDictionary(field => field.Name, field => Value(field.Value), StringComparer.Ordinal),
        JsonValueKind.Array => value.EnumerateArray().Select(Value).ToArray(), JsonValueKind.String => value.GetString(), JsonValueKind.True => true, JsonValueKind.False => false,
        JsonValueKind.Number => Number(value),
        _ => throw new InvalidDataException("TOML has no null or undefined configuration values")
    };
    private static object Number(JsonElement value)
    { if (value.TryGetInt64(out var integer)) return integer; if (value.TryGetUInt64(out var unsigned)) return unsigned; return value.GetDouble(); }
}
