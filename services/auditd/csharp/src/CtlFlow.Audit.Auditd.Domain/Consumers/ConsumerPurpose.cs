using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Consumers;

public sealed record ConsumerPurpose
{
    private ConsumerPurpose(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConsumerPurpose> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePurpose(value);
        return ValueTask.FromResult(new ConsumerPurpose(value));
    }

    public static ConsumerPurpose FromStorage(string value)
    {
        try
        {
            ValidatePurpose(value);
            return new ConsumerPurpose(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored consumer purpose is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
