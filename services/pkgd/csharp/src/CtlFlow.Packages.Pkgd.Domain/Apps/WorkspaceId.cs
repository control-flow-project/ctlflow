using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record WorkspaceId
{
    private WorkspaceId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<WorkspaceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new WorkspaceId(ValidateDeclarationId(
            value, 64, allowDot: false, "Workspace ID", stored: false)));
    }

    public static WorkspaceId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "Workspace ID", stored: true));
}
