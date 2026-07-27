using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Sources;

public sealed record WorkloadSubject
{
    private WorkloadSubject(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkloadSubject> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateWorkloadSubject(value);
        return ValueTask.FromResult(new WorkloadSubject(value));
    }

    public static WorkloadSubject FromStorage(string value)
    {
        try
        {
            ValidateWorkloadSubject(value);
            return new WorkloadSubject(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored workload subject is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
