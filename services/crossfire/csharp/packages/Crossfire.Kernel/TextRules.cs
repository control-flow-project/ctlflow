namespace Crossfire.Kernel;

public static class TextRules
{
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
