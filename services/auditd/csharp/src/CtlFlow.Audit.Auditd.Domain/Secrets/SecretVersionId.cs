using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Secrets;

public sealed record SecretVersionId
{
    private SecretVersionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<SecretVersionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new SecretVersionId(value));
    }

    public static SecretVersionId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new SecretVersionId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Secret version ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
