namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceRevision
{
    private WorkspaceRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static WorkspaceRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored Workspace revision must be positive");
        }

        return new WorkspaceRevision(value);
    }
}
