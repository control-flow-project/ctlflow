namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditResourceRevision
{
    private AuditResourceRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static AuditResourceRevision FromStorage(long value) =>
        value > 0
            ? new AuditResourceRevision(value)
            : throw new InvalidOperationException(
                "Stored audit resource revision must be positive");
}
