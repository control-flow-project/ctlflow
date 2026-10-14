using System.Text.Json;

namespace Crossfire.Kernel;

public readonly struct ProtocolWriter
{
    public static implicit operator Utf8JsonWriter(ProtocolWriter value) => value.writer;
    private readonly Utf8JsonWriter writer;
    public ProtocolWriter(Utf8JsonWriter writer) { this.writer = writer; }
    private static bool Unpaired(ReadOnlySpan<char> value)
    {
        var position = 0;
        while (position < value.Length)
        {
            var offset = value[position..].IndexOfAnyInRange('\ud800', '\udfff'); if (offset < 0) return false; position += offset;
            if (!char.IsHighSurrogate(value[position]) || position + 1 == value.Length || !char.IsLowSurrogate(value[position + 1])) return true; position += 2;
        }
        return false;
    }
    public void WritePropertyName(string name) => writer.WritePropertyName(name);
    public void WriteStringValue(string? value)
    { if (value is null) writer.WriteNullValue(); else if (Unpaired(value)) writer.WriteRawValue(ProtocolJson.Quote(value)); else writer.WriteStringValue(value); }
    public void WriteString(string name, string? value) { WritePropertyName(name); WriteStringValue(value); }
    public void WriteStartObject() => writer.WriteStartObject();
    public void WriteStartObject(string name) { WritePropertyName(name); writer.WriteStartObject(); }
    public void WriteEndObject() => writer.WriteEndObject();
    public void WriteStartArray() => writer.WriteStartArray();
    public void WriteStartArray(string name) { WritePropertyName(name); writer.WriteStartArray(); }
    public void WriteEndArray() => writer.WriteEndArray();
    public void WriteNull(string name) { WritePropertyName(name); writer.WriteNullValue(); }
    public void WriteNullValue() => writer.WriteNullValue();
    public void WriteBoolean(string name, bool value) => writer.WriteBoolean(name, value);
    public void WriteBooleanValue(bool value) => writer.WriteBooleanValue(value);
    public void WriteNumber(string name, long value) => writer.WriteNumber(name, value);
    public void WriteNumber(string name, ulong value) => writer.WriteNumber(name, value);
    public void WriteNumber(string name, double value) => writer.WriteNumber(name, value);
    public void WriteNumber(string name, decimal value) => writer.WriteNumber(name, value);
    public void WriteNumber(string name, int value) => writer.WriteNumber(name, value);
    public void WriteNumber(string name, uint value) => writer.WriteNumber(name, value);
    public void WriteNumberValue(long value) => writer.WriteNumberValue(value);
    public void WriteNumberValue(ulong value) => writer.WriteNumberValue(value);
    public void WriteNumberValue(double value) => writer.WriteNumberValue(value);
    public void WriteNumberValue(decimal value) => writer.WriteNumberValue(value);
    public void WriteNumberValue(int value) => writer.WriteNumberValue(value);
    public void WriteNumberValue(uint value) => writer.WriteNumberValue(value);
}
