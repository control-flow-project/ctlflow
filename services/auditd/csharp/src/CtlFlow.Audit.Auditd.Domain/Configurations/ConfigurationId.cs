using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Configurations;

public sealed record ConfigurationId
{
    private ConfigurationId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConfigurationId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new ConfigurationId(value));
    }

    public static ConfigurationId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new ConfigurationId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Configuration ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
