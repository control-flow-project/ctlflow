namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceProvisioningGeneration
{
    private WorkspaceProvisioningGeneration(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static WorkspaceProvisioningGeneration FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored Workspace provisioning generation must be positive");
        }

        return new WorkspaceProvisioningGeneration(value);
    }
}
