namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceRevision
{
    private WorkspaceRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static WorkspaceRevision Initial() => new(1);

    public static ValueTask<WorkspaceRevision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Workspace revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return ValueTask.FromResult(new WorkspaceRevision((long)value));
    }

    public WorkspaceRevision Next() => new(checked(Value + 1));

    public static WorkspaceRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored Workspace revision must be positive");
        }

        return new WorkspaceRevision(value);
    }
}
