using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Sources;

public sealed record OperatorCommonName
{
    private OperatorCommonName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<OperatorCommonName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateOperatorCommonName(value);
        return ValueTask.FromResult(new OperatorCommonName(value));
    }

    public static OperatorCommonName FromStorage(string value)
    {
        try
        {
            ValidateOperatorCommonName(value);
            return new OperatorCommonName(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored operator common name is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
