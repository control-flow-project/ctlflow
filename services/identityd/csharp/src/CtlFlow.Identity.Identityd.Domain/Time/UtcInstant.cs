namespace CtlFlow.Identity.Identityd.Domain.Time;

public sealed record UtcInstant
{
    private UtcInstant(DateTimeOffset value)
    {
        Value = value.ToUniversalTime();
    }

    public DateTimeOffset Value { get; }

    public long UnixMilliseconds => Value.ToUnixTimeMilliseconds();

    public static UtcInstant FromClock(DateTimeOffset value) => new(value);

    public static UtcInstant FromStorage(long unixMilliseconds)
    {
        if (unixMilliseconds <= 0)
        {
            throw new InvalidOperationException(
                "Stored timestamp must be positive");
        }

        return new UtcInstant(
            DateTimeOffset.FromUnixTimeMilliseconds(unixMilliseconds));
    }

    public UtcInstant Add(TimeSpan duration) => new(Value.Add(duration));

    public UtcInstant ToWholeSecond() =>
        new(DateTimeOffset.FromUnixTimeSeconds(Value.ToUnixTimeSeconds()));
}
