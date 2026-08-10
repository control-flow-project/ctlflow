using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Providers;

public sealed record ProviderId
{
    private ProviderId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProviderId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new ProviderId(value));
    }

    public static ProviderId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new ProviderId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored provider ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
