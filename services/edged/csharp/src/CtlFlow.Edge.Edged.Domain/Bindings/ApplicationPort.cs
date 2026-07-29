namespace CtlFlow.Edge.Edged.Domain.Bindings;

public readonly record struct ApplicationPort
{
    private ApplicationPort(int value) => Value = value;

    public int Value { get; }

    public static ValueTask<ApplicationPort> Parse(
        int value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is < 1 or > 65_535)
        {
            throw new ArgumentOutOfRangeException(
                nameof(value),
                "Application port is invalid");
        }

        return ValueTask.FromResult(new ApplicationPort(value));
    }
}
