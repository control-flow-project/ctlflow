using System.Text;
using System.Text.Json;

namespace Crossfire.Kernel;

public static class BackendData
{
    public static bool Valid(JsonElement value)
    {
        try { return value.ValueKind == JsonValueKind.Object && value.EnumerateObject().Count() <= 64
            && Encoding.UTF8.GetByteCount(WireJson.Compact(value)) <= 8192; }
        catch (Exception error) when (error is JsonException or InvalidDataException or InvalidOperationException) { return false; }
    }
    public static JsonElement Parse(string value)
    {
        using var document = JsonDocument.Parse(value);
        if (!Valid(document.RootElement)) throw new InvalidDataException("Invalid backend parameter object");
        return document.RootElement.Clone();
    }
    public static JsonElement? ParseNullable(string? value) => value is null ? null : Parse(value);
    public static bool Equal(JsonElement? left, JsonElement? right) => left is null ? right is null
        : right is not null && JsonElement.DeepEquals(left.Value, right.Value);
}
