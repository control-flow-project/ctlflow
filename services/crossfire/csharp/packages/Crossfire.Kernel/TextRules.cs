using System.Text;

namespace Crossfire.Kernel;

public static class TextRules
{
    public static string TruncateUtf16(string value, int maximum)
    {
        if (maximum < 0 || !WellFormed(value)) throw new ArgumentException("Use well-formed Unicode and a nonnegative text bound");
        if (value.Length <= maximum) return value;
        var boundary = maximum > 0 && char.IsHighSurrogate(value[maximum - 1]) && char.IsLowSurrogate(value[maximum]) ? maximum - 1 : maximum;
        return value[..boundary];
    }

    public static string TruncateUtf8(string value, int maximum)
    {
        if (maximum < 0 || !WellFormed(value)) throw new ArgumentException("Use well-formed Unicode and a nonnegative text bound");
        var bytes = 0; var boundary = 0;
        foreach (var scalar in value.EnumerateRunes())
        {
            bytes += scalar.Utf8SequenceLength;
            if (bytes > maximum) break;
            boundary += scalar.Utf16SequenceLength;
        }
        return value[..boundary];
    }

    public static bool WellFormed(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (!char.IsSurrogate(value[index])) continue;
            if (!char.IsHighSurrogate(value[index]) || index + 1 == value.Length || !char.IsLowSurrogate(value[index + 1])) return false;
            index++;
        }
        return true;
    }

    public static bool WhiteSpace(char value) => value is >= '\u0009' and <= '\u000d' or '\u0020' or '\u00a0' or '\u1680'
        or >= '\u2000' and <= '\u200a' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff';

    public static bool Blank(string value) => value.All(WhiteSpace);

    public static string Trim(string value)
    {
        var start = 0; var end = value.Length;
        while (start < end && WhiteSpace(value[start])) start++;
        while (end > start && WhiteSpace(value[end - 1])) end--;
        return value[start..end];
    }
}
