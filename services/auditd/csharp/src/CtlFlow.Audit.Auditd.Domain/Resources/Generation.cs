using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Resources;

public sealed record Generation
{
    private Generation(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ValueTask<Generation> Parse(
        long value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePositive(value, nameof(value));
        return ValueTask.FromResult(new Generation(value));
    }

    public static Generation FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored generation must be positive");
        }

        return new Generation(value);
    }
}
