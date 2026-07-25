namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceDisplayName
{
    private const int MaximumLength = 200;

    private WorkspaceDisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkspaceDisplayName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaximumLength)
        {
            throw new ArgumentException(
                "Workspace display name is invalid",
                nameof(value));
        }

        return ValueTask.FromResult(new WorkspaceDisplayName(value));
    }

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
