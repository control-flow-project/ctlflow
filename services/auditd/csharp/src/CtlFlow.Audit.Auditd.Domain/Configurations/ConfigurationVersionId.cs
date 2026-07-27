using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Configurations;

public sealed record ConfigurationVersionId
{
    private ConfigurationVersionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConfigurationVersionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new ConfigurationVersionId(value));
    }

    public static ConfigurationVersionId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new ConfigurationVersionId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Configuration version ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
