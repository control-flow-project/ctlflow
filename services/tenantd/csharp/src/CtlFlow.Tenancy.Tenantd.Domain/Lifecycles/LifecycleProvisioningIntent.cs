using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record LifecycleProvisioningIntent
{
    private LifecycleProvisioningIntent()
    {
    }

    public sealed record None : LifecycleProvisioningIntent;

    public sealed record Identity(
        InitialAdministratorIntent? InitialAdministrator,
        IReadOnlyList<InitialWorkspaceMembershipIntent> WorkspaceMemberships)
        : LifecycleProvisioningIntent;

    public sealed record Packages(
        IReadOnlyList<BaselinePackageIntent> BaselinePackages)
        : LifecycleProvisioningIntent;
}
