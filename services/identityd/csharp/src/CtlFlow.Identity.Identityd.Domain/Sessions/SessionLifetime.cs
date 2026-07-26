namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public sealed record SessionLifetime
{
    private static readonly TimeSpan Maximum = TimeSpan.FromDays(30);

    private SessionLifetime(TimeSpan value)
    {
        Value = value;
    }

    public TimeSpan Value { get; }

    public static SessionLifetime Parse(TimeSpan value) =>
        value > TimeSpan.Zero && value <= Maximum
            ? new SessionLifetime(value)
            : throw new ArgumentOutOfRangeException(
                nameof(value),
                "Session lifetime must be positive and at most 30 days");
}
