namespace CtlFlow.Policy.Policyd.Domain.Operations;

public readonly record struct OperationToken
{
    private OperationToken(string value) => Value = value;

    public string Value { get; }

    public static OperationToken Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 3 or > 128)
        {
            throw new ArgumentException(
                "Operation token is not canonical",
                nameof(value));
        }

        var separator = value.IndexOf('.');
        if (separator < 1 || separator != value.LastIndexOf('.')
            || separator == value.Length - 1)
        {
            throw new ArgumentException(
                "Operation token is not canonical",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character != '.'
                && character is not (>= 'a' and <= 'z')
                    and not (>= '0' and <= '9')
                    and not '_')
            {
                throw new ArgumentException(
                    "Operation token is not canonical",
                    nameof(value));
            }
        }

        return new OperationToken(value);
    }

    public static OperationToken FromStorage(string value) => Parse(value);

    public override string ToString() => Value;
}
