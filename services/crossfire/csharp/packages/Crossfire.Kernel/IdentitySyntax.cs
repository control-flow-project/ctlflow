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

    public static bool MatrixUser(string value)
    {
        if (value.Length is < 4 or > 255 || value[0] != '@' || value.Any(TextRules.WhiteSpace)) return false;
        var separator = value.IndexOf(':', 1);
        return separator > 1 && separator < value.Length - 1;
    }
}
