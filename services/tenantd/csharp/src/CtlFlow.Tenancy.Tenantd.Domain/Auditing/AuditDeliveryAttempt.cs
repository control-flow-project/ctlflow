namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditDeliveryAttempt
{
    private AuditDeliveryAttempt(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static AuditDeliveryAttempt FromStorage(int value) =>
        value > 0
            ? new AuditDeliveryAttempt(value)
            : throw new InvalidOperationException(
                "Stored audit delivery attempt must be positive");
}
