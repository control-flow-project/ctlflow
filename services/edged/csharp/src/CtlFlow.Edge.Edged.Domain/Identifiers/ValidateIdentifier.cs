namespace CtlFlow.Edge.Edged.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateIdentifier(string value, string name)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 64
            || value[0] is < 'a' or > 'z'
                && value[0] is < '0' or > '9')
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value)
        {
            if (character is >= 'a' and <= 'z'
                || character is >= '0' and <= '9'
                || character is '_' or '-')
            {
                continue;
            }

            throw new ArgumentException($"{name} is invalid", name);
        }

        return value;
    }
}
