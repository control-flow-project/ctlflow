namespace CtlFlow.Identity.Identityd.Domain.Resources;

public sealed record Revision
{
    private Revision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static Revision Initial() => new(1);

    public static Revision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored revision must be positive");
        }

        return new Revision(value);
    }

    public Revision Next() => new(checked(Value + 1));
}
