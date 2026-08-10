using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Groups;

public sealed record GroupId
{
    private GroupId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<GroupId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new GroupId(value));
    }

    public static GroupId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new GroupId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Group ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
