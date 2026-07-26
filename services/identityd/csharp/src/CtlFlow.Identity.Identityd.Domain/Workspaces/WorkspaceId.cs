using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Workspaces;

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
        return ValueTask.FromResult(
            new WorkspaceId(ValidateIdentifier(value, "Workspace ID")));
    }

    public static WorkspaceId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "Workspace ID"));

    public override string ToString() => Value;
}
