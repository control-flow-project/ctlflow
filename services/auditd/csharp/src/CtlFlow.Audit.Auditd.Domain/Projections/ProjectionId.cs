using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Projections;

public sealed record ProjectionId
{
    private ProjectionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProjectionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateProjectionId(value);
        return ValueTask.FromResult(new ProjectionId(value));
    }

    public static ProjectionId FromStorage(string value)
    {
        try
        {
            ValidateProjectionId(value);
            return new ProjectionId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Projection ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
