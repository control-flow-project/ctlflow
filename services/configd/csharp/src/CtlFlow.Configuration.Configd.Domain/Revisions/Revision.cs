namespace CtlFlow.Configuration.Configd.Domain.Revisions;

public sealed record Revision
{
    private Revision(long value) => Value = value;

    public long Value { get; }

    public static Revision Initial() => new(1);

    public static Revision Parse(ulong value)
    {
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return new Revision((long)value);
    }

    public static Revision FromStorage(long value) =>
        value > 0
            ? new Revision(value)
            : throw new InvalidOperationException(
                "Stored revision must be positive");

    public Revision Next() =>
        Value < long.MaxValue
            ? new Revision(Value + 1)
            : throw new InvalidOperationException("Revision is exhausted");
}
