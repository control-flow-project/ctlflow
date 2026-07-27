using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed record AuditEventId
{
    private AuditEventId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<AuditEventId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateEventId(value);
        return ValueTask.FromResult(new AuditEventId(value));
    }

    public static AuditEventId FromStorage(string value)
    {
        try
        {
            ValidateEventId(value);
            return new AuditEventId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored audit event ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
