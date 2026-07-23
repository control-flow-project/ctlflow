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

    public TenantAddressBindingId Id { get; private set; } = null!;

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public ExternalAuthority Authority => ExternalAuthority.FromStorage(_authority);

    public TenantPathPrefix PathPrefix => TenantPathPrefix.FromStorage(_pathPrefix);

    public AddressBindingGeneration BindingGeneration { get; private set; } = null!;

    public bool IsActive { get; private set; }

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;
}
