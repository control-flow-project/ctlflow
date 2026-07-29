namespace CtlFlow.Execution.Execd.Domain.Resources;

public sealed record Revision
{
    private Revision(long value) => Value = value;

    public long Value { get; }

    public static Revision Initial() => new(1);

    public static Revision Parse(ulong value)
    {
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException("revision must be positive", nameof(value));
        }

        return new Revision((long)value);
    }

    public static Revision FromStorage(long value) =>
        value > 0
            ? new Revision(value)
            : throw new InvalidOperationException("Stored revision is invalid");

    public Revision Next() => new(checked(Value + 1));
}
