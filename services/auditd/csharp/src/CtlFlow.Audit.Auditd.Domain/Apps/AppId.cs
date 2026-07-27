using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Apps;

public sealed record AppId
{
    private AppId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<AppId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new AppId(value));
    }

    public static AppId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new AppId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored App ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
