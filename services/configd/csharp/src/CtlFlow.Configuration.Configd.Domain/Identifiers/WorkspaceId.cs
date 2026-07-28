using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record WorkspaceId
{
    private WorkspaceId(string value) => Value = value;

    public string Value { get; }

    public static WorkspaceId Parse(string value) =>
        new(ValidateIdentifier(value, "Workspace ID"));

    public static WorkspaceId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "workspace ID"));
}
