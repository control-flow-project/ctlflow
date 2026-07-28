namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record Generation
{
    private Generation(long value) => Value = value;

    public long Value { get; }

    public static Generation Initial() => new(1);

    public static ValueTask<Generation> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(value is 0 or > long.MaxValue
            ? throw new ArgumentException(
                "Generation must be a positive signed 64-bit value",
                nameof(value))
            : new Generation((long)value));
    }

    public static Generation FromStorage(long value) =>
        value > 0
            ? new Generation(value)
            : throw new InvalidOperationException(
                "Stored generation must be positive");

    public Generation Next() => new(checked(Value + 1));
}
