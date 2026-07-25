namespace CtlFlow.Tenancy.Tenantd.Db.Provisioning;

public class TenantBaselinePackage
{
    private TenantBaselinePackage()
    {
    }

    internal TenantBaselinePackage(
        string tenantId,
        string packageId,
        string packageVersion)
    {
        TenantId = tenantId;
        PackageId = packageId;
        PackageVersion = packageVersion;
    }

    public string TenantId { get; private set; } = string.Empty;

    public string PackageId { get; private set; } = string.Empty;

    public string PackageVersion { get; private set; } = string.Empty;
}
