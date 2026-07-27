using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Runs;

public sealed record RunId
{
    private RunId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<RunId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePackageId(value, nameof(value));
        return ValueTask.FromResult(new RunId(value));
    }

    public static RunId FromStorage(string value)
    {
        try
        {
            ValidatePackageId(value, nameof(value));
            return new RunId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Run ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
