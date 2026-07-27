using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Workspaces;

public sealed record WorkspaceId
{
    private WorkspaceId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkspaceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new WorkspaceId(value));
    }

    public static WorkspaceId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new WorkspaceId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Workspace ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
