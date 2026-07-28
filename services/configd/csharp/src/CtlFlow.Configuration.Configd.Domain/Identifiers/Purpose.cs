using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record Purpose
{
    private Purpose(string value) => Value = value;

    public string Value { get; }

    public static Purpose Parse(string value) =>
        new(Validate(value, stored: false));

    public static Purpose FromStorage(string value) =>
        new(Validate(value, stored: true));

    private static string Validate(string value, bool stored)
    {
        var valid = value.Length is > 0 and <= 64
            && value[0] is >= 'a' and <= 'z';
        var previousUnderscore = false;
        foreach (var character in value)
        {
            if (character == '_')
            {
                if (previousUnderscore)
                {
                    valid = false;
                }

                previousUnderscore = true;
                continue;
            }

            if (!IsLowerAlphaNumeric(character))
            {
                valid = false;
            }

            previousUnderscore = false;
        }

        valid = valid && !previousUnderscore;
        if (!valid)
        {
            if (stored)
            {
                throw new InvalidOperationException("Stored purpose is not canonical");
            }

            throw new ArgumentException("Purpose is not canonical", nameof(value));
        }

        return value;
    }
}
