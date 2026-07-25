using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public class TenantAddressBinding
{
    private string _tenantId = string.Empty;
    private string _authority = string.Empty;
    private string _pathPrefix = string.Empty;

    private TenantAddressBinding()
    {
    }

    internal TenantAddressBinding(
        TenantAddressBindingId id,
        TenantId tenantId,
        ExternalAuthority authority,
        TenantPathPrefix pathPrefix,
        UtcInstant now)
    {
        Id = id;
        _tenantId = tenantId.Value;
        _authority = authority.Value;
        _pathPrefix = pathPrefix.Value;
        BindingGeneration = AddressBindingGeneration.Initial();
        IsActive = true;
        CreatedAt = now;
        UpdatedAt = now;
    }

    internal TenantAddressBinding(
        TenantAddressBindingId id,
        TenantId tenantId,
        ExternalAuthority authority,
        TenantPathPrefix pathPrefix,
        AddressBindingGeneration bindingGeneration,
        bool isActive,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        Id = id;
        _tenantId = tenantId.Value;
        _authority = authority.Value;
        _pathPrefix = pathPrefix.Value;
        BindingGeneration = bindingGeneration;
        IsActive = isActive;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public TenantAddressBindingId Id { get; internal set; } = null!;

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public ExternalAuthority Authority => ExternalAuthority.FromStorage(_authority);

    public TenantPathPrefix PathPrefix => TenantPathPrefix.FromStorage(_pathPrefix);

    public AddressBindingGeneration BindingGeneration { get; internal set; } = null!;

    public bool IsActive { get; internal set; }

    public UtcInstant CreatedAt { get; internal set; } = null!;

    public UtcInstant UpdatedAt { get; internal set; } = null!;
}
