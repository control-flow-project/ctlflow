namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record Revision
{
    private Revision(long value) => Value = value;

    public long Value { get; }

    public static Revision Initial() => new(1);

    public static ValueTask<Revision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(value is 0 or > long.MaxValue
            ? throw new ArgumentException(
                "Revision must be a positive signed 64-bit value",
                nameof(value))
            : new Revision((long)value));
    }

    public static Revision FromStorage(long value) =>
        value > 0
            ? new Revision(value)
            : throw new InvalidOperationException(
                "Stored revision must be positive");

    public Revision Next() => new(checked(Value + 1));
}
