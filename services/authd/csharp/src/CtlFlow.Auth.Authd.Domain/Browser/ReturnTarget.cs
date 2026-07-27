namespace CtlFlow.Auth.Authd.Domain.Browser;

public sealed record ReturnTarget
{
    private ReturnTarget(string value) => Value = value;

    public string Value { get; }

    public static ReturnTarget Default { get; } = new("/");

    public static ReturnTarget Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 2_048
            || value[0] != '/'
            || (value.Length > 1 && value[1] == '/'))
        {
            throw new ArgumentException(
                "Return target has an invalid shape",
                nameof(value));
        }

        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character > 0x7f
                || character is <= ' ' or '\\' or '#')
            {
                throw new ArgumentException(
                    "Return target has an invalid character",
                    nameof(value));
            }

            if (character != '%')
            {
                continue;
            }

            if (index + 2 >= value.Length
                || !IsHex(value[index + 1])
                || !IsHex(value[index + 2]))
            {
                throw new ArgumentException(
                    "Return target has invalid percent encoding",
                    nameof(value));
            }

            index += 2;
        }

        return new ReturnTarget(value);
    }

    public override string ToString() => "[REDACTED]";

    private static bool IsHex(char value) =>
        value is >= '0' and <= '9'
            or >= 'A' and <= 'F'
            or >= 'a' and <= 'f';
}
