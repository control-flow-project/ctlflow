using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Consumers;

public sealed record ConsumerId
{
    private ConsumerId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConsumerId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new ConsumerId(value));
    }

    public static ConsumerId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new ConsumerId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Consumer ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
