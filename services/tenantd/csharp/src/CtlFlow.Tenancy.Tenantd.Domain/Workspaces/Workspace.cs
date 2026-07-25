using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public class Workspace
{
    private string _id = string.Empty;
    private string _tenantId = string.Empty;
    private string? _currentOperationId;

    private Workspace()
    {
    }

    internal Workspace(
        WorkspaceId id,
        TenantId tenantId,
        WorkspaceDisplayName displayName,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now)
    {
        _id = id.Value;
        _tenantId = tenantId.Value;
        _currentOperationId = operationId.Value;
        DisplayName = displayName;
        Lifecycle = LifecycleState.Provisioning;
        Revision = WorkspaceRevision.Initial();
        ProvisioningGeneration = WorkspaceProvisioningGeneration.Initial();
        LastEventSequence = eventSequence;
        CreatedAt = now;
        UpdatedAt = now;
    }

    internal Workspace(
        WorkspaceId id,
        TenantId tenantId,
        WorkspaceDisplayName displayName,
        LifecycleState lifecycle,
        WorkspaceRevision revision,
        WorkspaceProvisioningGeneration provisioningGeneration,
        LifecycleOperationId? currentOperationId,
        ResourceEventSequence lastEventSequence,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _id = id.Value;
        _tenantId = tenantId.Value;
        _currentOperationId = currentOperationId?.Value;
        DisplayName = displayName;
        Lifecycle = lifecycle;
        Revision = revision;
        ProvisioningGeneration = provisioningGeneration;
        LastEventSequence = lastEventSequence;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public WorkspaceId Id => WorkspaceId.FromStorage(_id);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceDisplayName DisplayName { get; internal set; } = null!;

    public LifecycleState Lifecycle { get; internal set; }

    public WorkspaceRevision Revision { get; internal set; } = null!;

    public WorkspaceProvisioningGeneration ProvisioningGeneration { get; internal set; } = null!;

    public LifecycleOperationId? CurrentOperationId =>
        _currentOperationId is null
            ? null
            : LifecycleOperationId.FromStorage(_currentOperationId);

    internal string? CurrentOperationStorage
    {
        get => _currentOperationId;
        set => _currentOperationId = value;
    }

    public ResourceEventSequence LastEventSequence { get; internal set; } = null!;

    public UtcInstant CreatedAt { get; internal set; } = null!;

    public UtcInstant UpdatedAt { get; internal set; } = null!;
}
