using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Crossfire.Kernel;

public static class WireJson
{
    public static JsonElement Build(Action<ProtocolWriter> write)
    { var bytes = new ArrayBufferWriter<byte>(); using (var writer = new Utf8JsonWriter(bytes)) write(new ProtocolWriter(writer)); using var document = JsonDocument.Parse(bytes.WrittenMemory); return document.RootElement.Clone(); }
    public static JsonElement Object(Action<ProtocolWriter> write) => Build(writer => { writer.WriteStartObject(); write(writer); writer.WriteEndObject(); });
    public static JsonElement Array(Action<ProtocolWriter> write) => Build(writer => { writer.WriteStartArray(); write(writer); writer.WriteEndArray(); });
    public static JsonElement Parse(ReadOnlyMemory<byte> bytes)
    { using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 65 }); return document.RootElement.Clone(); }
    public static string? Text(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String ? ProtocolJson.Unquote(field.GetRawText()).Value : null;
    public static string Compact(JsonElement value) { var result = new StringBuilder(); Append(result, value, 0, 0); return result.ToString(); }
    public static string Pretty(JsonElement value) { var result = new StringBuilder(); Append(result, value, 2, 0); return result.Append('\n').ToString(); }
    public static byte[] Bytes(JsonElement value, bool pretty = false) => Encoding.UTF8.GetBytes(pretty ? Pretty(value) : Compact(value));
    private static uint? Index(string name)
        => uint.TryParse(name, NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number < uint.MaxValue && number.ToString(CultureInfo.InvariantCulture) == name ? number : null;
    private static void Newline(StringBuilder output, int indent, int depth) { if (indent != 0) output.Append('\n').Append(' ', checked(indent * depth)); }
    private static void Append(StringBuilder output, JsonElement value, int indent, int depth)
    {
        if (depth > 64) throw new InvalidDataException("JSON exceeds the protocol nesting bound");
        switch (value.ValueKind)
        {
            case JsonValueKind.Null: output.Append("null"); break;
            case JsonValueKind.True: output.Append("true"); break;
            case JsonValueKind.False: output.Append("false"); break;
            case JsonValueKind.String: ProtocolJson.String(output, ProtocolJson.Unquote(value.GetRawText()).Value); break;
            case JsonValueKind.Number:
                var number = value.GetDouble(); if (!double.IsFinite(number)) throw new InvalidDataException("JSON numbers must be finite"); output.Append(Number(number)); break;
            case JsonValueKind.Array:
                output.Append('['); var first = true;
                foreach (var item in value.EnumerateArray()) { if (!first) output.Append(','); Newline(output, indent, depth + 1); Append(output, item, indent, depth + 1); first = false; }
                if (!first) Newline(output, indent, depth); output.Append(']'); break;
            case JsonValueKind.Object:
                var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal); foreach (var field in value.EnumerateObject()) fields[field.Name] = field.Value;
                var ordered = fields.Keys.Select((name, position) => (Name: name, Position: position, Index: Index(name))).OrderBy(field => field.Index is null ? 1 : 0).ThenBy(field => field.Index ?? 0).ThenBy(field => field.Position);
                output.Append('{'); first = true;
                foreach (var field in ordered) { if (!first) output.Append(','); Newline(output, indent, depth + 1); ProtocolJson.String(output, field.Name); output.Append(indent == 0 ? ":" : ": "); Append(output, fields[field.Name], indent, depth + 1); first = false; }
                if (!first) Newline(output, indent, depth); output.Append('}'); break;
            default: throw new InvalidDataException("Undefined JSON is not protocol data");
        }
    }
    private static string Number(double number)
    {
        if (number == 0) return "0"; var negative = number < 0; var text = Math.Abs(number).ToString("R", CultureInfo.InvariantCulture); var exponentAt = text.IndexOfAny(['E', 'e']);
        var exponent = exponentAt < 0 ? 0 : int.Parse(text.AsSpan(exponentAt + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture); var fraction = exponentAt < 0 ? text : text[..exponentAt];
        var point = fraction.IndexOf('.'); var position = (point < 0 ? fraction.Length : point) + exponent; var digits = fraction.Replace(".", "", StringComparison.Ordinal);
        while (digits.Length > 1 && digits[0] == '0') { digits = digits[1..]; position--; }
        digits = digits.TrimEnd('0'); if (digits.Length == 0) digits = "0"; string result;
        if (position > 0 && position <= 21) result = position >= digits.Length ? digits + new string('0', position - digits.Length) : digits.Insert(position, ".");
        else if (position <= 0 && position > -6) result = "0." + new string('0', -position) + digits;
        else { var power = position - 1; result = digits[0] + (digits.Length == 1 ? "" : "." + digits[1..]) + "e" + (power >= 0 ? "+" : "") + power.ToString(CultureInfo.InvariantCulture); }
        return negative ? "-" + result : result;
    }
}
