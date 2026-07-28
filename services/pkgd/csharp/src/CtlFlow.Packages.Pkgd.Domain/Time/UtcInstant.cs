namespace CtlFlow.Packages.Pkgd.Domain.Time;

public sealed record UtcInstant
{
    private UtcInstant(DateTimeOffset value) =>
        Value = value.ToUniversalTime();

    public DateTimeOffset Value { get; }

    public long UnixMilliseconds => Value.ToUnixTimeMilliseconds();

    public static UtcInstant FromClock(DateTimeOffset value) => new(value);

    public static UtcInstant FromStorage(long unixMilliseconds) =>
        unixMilliseconds > 0
            ? new UtcInstant(
                DateTimeOffset.FromUnixTimeMilliseconds(unixMilliseconds))
            : throw new InvalidOperationException(
                "Stored timestamp must be positive");
}
