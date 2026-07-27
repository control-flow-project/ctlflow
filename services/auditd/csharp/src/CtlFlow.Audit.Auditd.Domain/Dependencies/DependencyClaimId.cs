using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Dependencies;

public sealed record DependencyClaimId
{
    private DependencyClaimId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<DependencyClaimId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateDependencyClaimId(value);
        return ValueTask.FromResult(new DependencyClaimId(value));
    }

    public static DependencyClaimId FromStorage(string value)
    {
        try
        {
            ValidateDependencyClaimId(value);
            return new DependencyClaimId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored dependency claim ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
