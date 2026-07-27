using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Sessions;

public sealed record SessionId
{
    private SessionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<SessionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateSessionId(value);
        return ValueTask.FromResult(new SessionId(value));
    }

    public static SessionId FromStorage(string value)
    {
        try
        {
            ValidateSessionId(value);
            return new SessionId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Session ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
