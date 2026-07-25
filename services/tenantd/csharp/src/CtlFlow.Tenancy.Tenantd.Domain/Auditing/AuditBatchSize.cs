namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditBatchSize
{
    private const int Maximum = 100;

    private AuditBatchSize(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static ValueTask<AuditBatchSize> Parse(
        int value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is < 1 or > Maximum)
        {
            throw new ArgumentOutOfRangeException(
                nameof(value),
                "Audit batch size must be between 1 and 100");
        }

        return ValueTask.FromResult(new AuditBatchSize(value));
    }
}
