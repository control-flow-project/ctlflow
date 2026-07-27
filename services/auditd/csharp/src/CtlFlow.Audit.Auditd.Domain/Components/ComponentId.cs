using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Components;

public sealed record ComponentId
{
    private ComponentId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ComponentId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new ComponentId(value));
    }

    public static ComponentId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new ComponentId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Component ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
