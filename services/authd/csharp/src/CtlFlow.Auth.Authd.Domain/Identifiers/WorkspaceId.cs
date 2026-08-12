using static CtlFlow.Auth.Authd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Auth.Authd.Domain.Identifiers;

public sealed record WorkspaceId
{
    private WorkspaceId(string value) => Value = value;

    public string Value { get; }

    public static WorkspaceId Parse(string value) =>
        new(ValidateIdentifier(value, nameof(value)));
}
