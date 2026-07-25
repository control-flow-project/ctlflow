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

    internal WorkspaceAddressBinding(
        WorkspaceAddressBindingId id,
        TenantId tenantId,
        WorkspaceId workspaceId,
        WorkspaceAddress workspaceAddress,
        UtcInstant now)
    {
        Id = id;
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId.Value;
        _workspaceAddress = workspaceAddress.Value;
        BindingGeneration = AddressBindingGeneration.Initial();
        IsActive = true;
        CreatedAt = now;
        UpdatedAt = now;
    }

    internal WorkspaceAddressBinding(
        WorkspaceAddressBindingId id,
        TenantId tenantId,
        WorkspaceId workspaceId,
        WorkspaceAddress workspaceAddress,
        AddressBindingGeneration bindingGeneration,
        bool isActive,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        Id = id;
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId.Value;
        _workspaceAddress = workspaceAddress.Value;
        BindingGeneration = bindingGeneration;
        IsActive = isActive;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public WorkspaceAddressBindingId Id { get; internal set; } = null!;

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId WorkspaceId => WorkspaceId.FromStorage(_workspaceId);

    public WorkspaceAddress WorkspaceAddress => WorkspaceAddress.FromStorage(_workspaceAddress);

    public AddressBindingGeneration BindingGeneration { get; internal set; } = null!;

    public bool IsActive { get; internal set; }

    public UtcInstant CreatedAt { get; internal set; } = null!;

    public UtcInstant UpdatedAt { get; internal set; } = null!;
}
