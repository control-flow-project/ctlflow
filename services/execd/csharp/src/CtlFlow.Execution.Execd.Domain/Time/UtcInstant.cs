namespace CtlFlow.Execution.Execd.Domain.Time;

public sealed record UtcInstant
{
    private UtcInstant(DateTimeOffset value) => Value = value.ToUniversalTime();

    public DateTimeOffset Value { get; }
    public long UnixMilliseconds => Value.ToUnixTimeMilliseconds();

    public static UtcInstant FromClock(DateTimeOffset value) => new(value);

    public static UtcInstant FromStorage(long value) =>
        value > 0
            ? new UtcInstant(DateTimeOffset.FromUnixTimeMilliseconds(value))
            : throw new InvalidOperationException("Stored timestamp is invalid");
}
