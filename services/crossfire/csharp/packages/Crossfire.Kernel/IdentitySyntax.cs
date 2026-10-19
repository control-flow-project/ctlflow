namespace Crossfire.Kernel;

public static class IdentitySyntax
{
    public static bool Identifier(string value)
    {
        if (value.Length != 36) return false;
        for (var position = 0; position < value.Length; position++)
        {
            if (position is 8 or 13 or 18 or 23) { if (value[position] != '-') return false; }
            else if (value[position] is not (>= 'a' and <= 'f' or >= '0' and <= '9')) return false;
        }
        return true;
    }

    public static bool Name(string value) => value.Length is >= 1 and <= 40 && value[0] is >= 'a' and <= 'z'
        && value.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9' or '-');

    public static bool BackendIdentifier(string value) => value.Length is >= 1 and <= 255 && TextRules.WellFormed(value)
        && value.All(character => character is not (<= '\u001f' or '\u007f'));
}
