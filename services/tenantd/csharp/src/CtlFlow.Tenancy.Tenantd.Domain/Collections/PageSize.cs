namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public sealed record PageSize
{
    public const int Maximum = 100;
    public const int Default = 50;

    private PageSize(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static ValueTask<PageSize> Parse(
        int? value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var parsed = value ?? Default;
        if (parsed is < 1 or > Maximum)
        {
            throw new ArgumentOutOfRangeException(
                nameof(value),
                "Page size must be between one and 100");
        }

        return ValueTask.FromResult(new PageSize(parsed));
    }
}
