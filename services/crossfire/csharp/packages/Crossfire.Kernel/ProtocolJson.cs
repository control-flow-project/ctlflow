using System.Text;

namespace Crossfire.Kernel;

public static class ProtocolJson
{
    public static Result<string> Unquote(ReadOnlySpan<char> input)
    {
        if (input.Length < 2 || input[0] != '"' || input[^1] != '"') return Results.Fail<string>("invalid", "Expected a JSON string");
        var value = input[1..^1];
        if (value.IndexOf('\\') < 0) return value.IndexOf('"') >= 0 || value.IndexOfAnyInRange('\u0000', '\u001f') >= 0
            ? Results.Fail<string>("invalid", "Invalid JSON string character") : Result<string>.Success(value.ToString());
        var output = new StringBuilder(value.Length);
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character != '\\')
            {
                if (character is '"' or < '\u0020') return Results.Fail<string>("invalid", "Invalid JSON string character");
                output.Append(character); continue;
            }
            if (++index == value.Length) return Results.Fail<string>("invalid", "Incomplete JSON string escape");
            switch (value[index])
            {
                case '"': output.Append('"'); break;
                case '\\': output.Append('\\'); break;
                case '/': output.Append('/'); break;
                case 'b': output.Append('\b'); break;
                case 'f': output.Append('\f'); break;
                case 'n': output.Append('\n'); break;
                case 'r': output.Append('\r'); break;
                case 't': output.Append('\t'); break;
                case 'u':
                    if (index + 4 >= value.Length || !ushort.TryParse(value.Slice(index + 1, 4), System.Globalization.NumberStyles.AllowHexSpecifier,
                        System.Globalization.CultureInfo.InvariantCulture, out var code)) return Results.Fail<string>("invalid", "Invalid JSON Unicode escape");
                    output.Append((char)code); index += 4; break;
                default: return Results.Fail<string>("invalid", "Invalid JSON string escape");
            }
        }
        return Result<string>.Success(output.ToString());
    }

    public static string Quote(string value)
    {
        var output = new StringBuilder(value.Length + 2);
        String(output, value);
        return output.ToString();
    }

    public static void String(StringBuilder output, string value)
    {
        output.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            switch (character)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (character < '\u0020' || char.IsSurrogate(character) && !(char.IsHighSurrogate(character)
                        && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1])))
                        output.Append("\\u").Append(((int)character).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                    else
                    {
                        output.Append(character);
                        if (char.IsHighSurrogate(character)) output.Append(value[++index]);
                    }
                    break;
            }
        }
        output.Append('"');
    }
}
