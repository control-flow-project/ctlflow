using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public class WorkspaceAddressBinding
{
    private string _tenantId = string.Empty;
    private string _workspaceId = string.Empty;
    private string _workspaceAddress = string.Empty;

    private WorkspaceAddressBinding()
    {
    }

    public WorkspaceAddressBindingId Id { get; private set; } = null!;

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId WorkspaceId => WorkspaceId.FromStorage(_workspaceId);

    public WorkspaceAddress WorkspaceAddress => WorkspaceAddress.FromStorage(_workspaceAddress);

    public AddressBindingGeneration BindingGeneration { get; private set; } = null!;

    public bool IsActive { get; private set; }

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;
}
