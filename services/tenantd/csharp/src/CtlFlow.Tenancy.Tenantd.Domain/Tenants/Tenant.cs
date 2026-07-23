using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public class Tenant
{
    private string _id = string.Empty;

    private Tenant()
    {
    }

    public TenantId Id => TenantId.FromStorage(_id);

    public TenantDisplayName DisplayName { get; private set; } = null!;

    public TenantLifecycle Lifecycle { get; private set; }

    public TenantRevision Revision { get; private set; } = null!;

    public TenantProvisioningGeneration ProvisioningGeneration { get; private set; } = null!;

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;
}
