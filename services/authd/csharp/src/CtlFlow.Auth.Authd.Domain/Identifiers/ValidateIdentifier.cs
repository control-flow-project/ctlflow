namespace CtlFlow.Auth.Authd.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateIdentifier(
        string value,
        string parameterName)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        if (value.Length is < 1 or > 64
            || value[0] is not (>= 'a' and <= 'z'
                or >= '0' and <= '9'))
        {
            throw new ArgumentException(
                "Identifier has an invalid shape",
                parameterName);
        }

        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '_'
                or '-'))
            {
                throw new ArgumentException(
                    "Identifier has an invalid shape",
                    parameterName);
            }
        }

        return value;
    }
}
