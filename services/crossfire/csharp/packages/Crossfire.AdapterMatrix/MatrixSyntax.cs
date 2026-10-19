using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class MatrixSyntax
{
    public static bool UserId(string value)
    {
        if (value.Length is < 4 or > 255 || value[0] != '@' || !TextRules.WellFormed(value) || value.Any(TextRules.WhiteSpace)) return false;
        var separator = value.IndexOf(':', 1);
        return separator > 1 && separator < value.Length - 1;
    }
    public static bool RoomId(string value) => value.Length is >= 2 and <= 255 && value[0] == '!'
        && TextRules.WellFormed(value) && !value.Any(TextRules.WhiteSpace);
    public static bool EventId(string value) => value.Length is >= 2 and <= 255 && value[0] == '$'
        && TextRules.WellFormed(value) && !value.Any(TextRules.WhiteSpace);
}
