using System.Text;
using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class MatrixNotices
{
    public const int MaximumBytes = 50000;
    public static JsonElement Content(string text)
    {
        var value = WireJson.Object(writer => { writer.WriteString("msgtype", "m.notice"); writer.WriteString("body", text); writer.WriteBoolean("org.crossfire.listener_notice", true); });
        if (Encoding.UTF8.GetByteCount(WireJson.Compact(value)) > MaximumBytes) throw new InvalidDataException("Encoded owner notice exceeds the native message limit"); return value;
    }
    public static bool Fits(string text) => Encoding.UTF8.GetByteCount("{\"msgtype\":\"m.notice\",\"body\":" + WireJson.Compact(WireJson.Build(writer => writer.WriteStringValue(text))) + ",\"org.crossfire.listener_notice\":true}") <= MaximumBytes;
    public static IReadOnlyList<string> Chunks(string text)
    {
        var maximum = MaximumBytes - Encoding.UTF8.GetByteCount(WireJson.Compact(Content(""))); var result = new List<string>(); var selected = new StringBuilder(); var size = 0;
        for (var index = 0; index < text.Length; index++)
        {
            var length = char.IsHighSurrogate(text[index]) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]) ? 2 : 1; var character = text.Substring(index, length); index += length - 1;
            var encoded = new StringBuilder(); ProtocolJson.String(encoded, character); var bytes = Encoding.UTF8.GetByteCount(encoded.ToString()) - 2;
            if (size + bytes > maximum) { result.Add(selected.ToString()); selected.Clear(); size = 0; } selected.Append(character); size += bytes;
        }
        if (selected.Length != 0) result.Add(selected.ToString()); return result;
    }
}
