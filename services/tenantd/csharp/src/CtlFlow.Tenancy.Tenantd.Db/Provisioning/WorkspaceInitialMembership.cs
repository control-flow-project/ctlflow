namespace CtlFlow.Tenancy.Tenantd.Db.Provisioning;

public class WorkspaceInitialMembership
{
    private WorkspaceInitialMembership()
    {
    }

    internal WorkspaceInitialMembership(
        string workspaceId,
        string userId,
        int standing)
    {
        WorkspaceId = workspaceId;
        UserId = userId;
        Standing = standing;
    }

    public string WorkspaceId { get; private set; } = string.Empty;

    public string UserId { get; private set; } = string.Empty;

    public int Standing { get; private set; }
}
