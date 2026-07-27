using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Workloads;

public sealed record WorkloadId
{
    private WorkloadId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkloadId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new WorkloadId(value));
    }

    public static WorkloadId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new WorkloadId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Workload ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
