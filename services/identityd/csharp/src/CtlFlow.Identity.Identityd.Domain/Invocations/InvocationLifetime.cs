namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public sealed record InvocationLifetime
{
    private static readonly TimeSpan Maximum = TimeSpan.FromSeconds(60);

    private InvocationLifetime(TimeSpan value)
    {
        Value = value;
    }

    public TimeSpan Value { get; }

    public static InvocationLifetime Parse(TimeSpan value) =>
        value > TimeSpan.Zero && value <= Maximum
            ? new InvocationLifetime(value)
            : throw new ArgumentOutOfRangeException(
                nameof(value),
                "Invocation lifetime must be positive and at most 60 seconds");
}
