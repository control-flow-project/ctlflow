using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Resources;

public sealed record Revision
{
    private Revision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ValueTask<Revision> Parse(
        long value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePositive(value, nameof(value));
        return ValueTask.FromResult(new Revision(value));
    }

    public static Revision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored revision must be positive");
        }

        return new Revision(value);
    }
}
