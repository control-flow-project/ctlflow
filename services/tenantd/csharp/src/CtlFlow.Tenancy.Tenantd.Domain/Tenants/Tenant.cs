using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public class Tenant
{
    private string _address = null!;
    private string _id = null!;

    private Tenant()
    {
    }

    internal Tenant(
        TenantId id,
        ResourceAddress address,
        DisplayName displayName,
        ResourceState state,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _id = id.Value;
        _address = address.Value;
        DisplayName = displayName;
        State = state;
        Revision = revision;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public TenantId Id => TenantId.FromStorage(_id);

    public ResourceAddress Address => ResourceAddress.FromStorage(_address);

    public DisplayName DisplayName { get; private set; } = null!;

    public ResourceState State { get; private set; }

    public Revision Revision { get; private set; } = null!;

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;

    internal void ChangeDisplayName(DisplayName displayName, UtcInstant now)
    {
        DisplayName = displayName;
        Revision = Revision.Next();
        UpdatedAt = now;
    }

    internal void ChangeState(ResourceState state, UtcInstant now)
    {
        State = state;
        Revision = Revision.Next();
        UpdatedAt = now;
    }
}
