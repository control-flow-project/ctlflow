namespace CtlFlow.Execution.Execd.Domain.Operations;

// A canonical product operation received from Pkgd and retained with an
// admitted Workload. Package ID supplies its authorization namespace.
public sealed record OperationToken
{
    private const int MaximumLength = 128;

    private OperationToken(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<OperationToken> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new OperationToken(Validate(value)));
    }

    public static OperationToken FromStorage(string value) =>
        new(Validate(value));

    private static string Validate(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var separator = value.IndexOf('.', StringComparison.Ordinal);
        if (value.Length is < 3 or > MaximumLength
            || separator < 1
            || separator != value.LastIndexOf('.')
            || separator == value.Length - 1)
        {
            throw new ArgumentException(
                "Operation token is not canonical",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'z')
                and not (>= '0' and <= '9')
                and not ('_' or '.'))
            {
                throw new ArgumentException(
                    "Operation token is not canonical",
                    nameof(value));
            }
        }

        return value;
    }
}
