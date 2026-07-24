namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceDisplayName
{
    private const int MaximumLength = 200;

    private WorkspaceDisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static WorkspaceDisplayName FromStorage(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaximumLength)
        {
            throw new InvalidOperationException("Stored Workspace display name is invalid");
        }

        return new WorkspaceDisplayName(value);
    }

    public override string ToString() => Value;
}
