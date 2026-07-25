namespace CtlFlow.Tenancy.Tenantd.Db.Provisioning;

public class WorkspaceBaselinePackage
{
    private WorkspaceBaselinePackage()
    {
    }

    internal WorkspaceBaselinePackage(
        string workspaceId,
        string packageId,
        string packageVersion)
    {
        WorkspaceId = workspaceId;
        PackageId = packageId;
        PackageVersion = packageVersion;
    }

    public string WorkspaceId { get; private set; } = string.Empty;

    public string PackageId { get; private set; } = string.Empty;

    public string PackageVersion { get; private set; } = string.Empty;
}
