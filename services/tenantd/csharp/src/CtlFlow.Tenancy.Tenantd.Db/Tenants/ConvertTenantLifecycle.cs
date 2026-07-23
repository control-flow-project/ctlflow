using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static class TenantLifecycleStorage
{
    internal static int ToStorage(TenantLifecycle lifecycle) =>
        lifecycle switch
        {
            (TenantLifecycle)0 => 0,
            TenantLifecycle.Provisioning => 1,
            TenantLifecycle.Active => 2,
            TenantLifecycle.Suspended => 3,
            TenantLifecycle.Deleting => 4,
            TenantLifecycle.Failed => 5,
            TenantLifecycle.Deleted => 6,
            _ => throw new InvalidOperationException("Unknown Tenant lifecycle")
        };

    internal static TenantLifecycle FromStorage(int value) =>
        value switch
        {
            0 => (TenantLifecycle)0,
            1 => TenantLifecycle.Provisioning,
            2 => TenantLifecycle.Active,
            3 => TenantLifecycle.Suspended,
            4 => TenantLifecycle.Deleting,
            5 => TenantLifecycle.Failed,
            6 => TenantLifecycle.Deleted,
            _ => throw new InvalidOperationException(
                "Unknown stored Tenant lifecycle")
        };
}
