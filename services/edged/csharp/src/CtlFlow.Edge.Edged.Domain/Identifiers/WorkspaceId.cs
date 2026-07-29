using static CtlFlow.Edge.Edged.Domain.Identifiers.Identifiers;

namespace CtlFlow.Edge.Edged.Domain.Identifiers;

public sealed class WorkspaceId
{
    private WorkspaceId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<WorkspaceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new WorkspaceId(ValidateIdentifier(value, nameof(value))));
    }
}
