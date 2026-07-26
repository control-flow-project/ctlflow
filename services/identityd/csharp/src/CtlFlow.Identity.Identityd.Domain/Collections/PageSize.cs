namespace CtlFlow.Identity.Identityd.Domain.Collections;

public sealed record PageSize
{
    public const int Default = 50;
    public const int Maximum = 100;

    private PageSize(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static ValueTask<PageSize> Parse(
        uint value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var admitted = value == 0 ? Default : checked((int)value);
        if (admitted is < 1 or > Maximum)
        {
            throw new ArgumentException(
                $"Page size must be between 1 and {Maximum}",
                nameof(value));
        }

        return ValueTask.FromResult(new PageSize(admitted));
    }
}
