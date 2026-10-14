namespace Crossfire.Contracts;

public static class ReleaseValues
{
    public static bool Version(string value) => value.Length is >= 5 and <= 40 && value.Split('.') is { Length: 3 } parts && parts.All(part => part.Length != 0 && part.All(char.IsAsciiDigit));
    public static bool Identity(string value)
    { var separator = value.LastIndexOf('-'); return separator > 0 && Version(value[..separator]) && value.Length == separator + 25 && value[(separator + 1)..].All(character => character is >= 'a' and <= 'f' or >= '0' and <= '9'); }
}
