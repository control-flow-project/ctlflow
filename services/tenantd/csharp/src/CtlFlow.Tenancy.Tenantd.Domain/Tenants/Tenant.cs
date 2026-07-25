using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public class Tenant
{
    private string _id = string.Empty;
    private string? _currentOperationId;

    private Tenant()
    {
    }

    internal Tenant(
        TenantId id,
        TenantDisplayName displayName,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now)
    {
        _id = id.Value;
        _currentOperationId = operationId.Value;
        DisplayName = displayName;
        Lifecycle = LifecycleState.Provisioning;
        Revision = TenantRevision.Initial();
        ProvisioningGeneration = TenantProvisioningGeneration.Initial();
        LastEventSequence = eventSequence;
        CreatedAt = now;
        UpdatedAt = now;
    }

    internal Tenant(
        TenantId id,
        TenantDisplayName displayName,
        LifecycleState lifecycle,
        TenantRevision revision,
        TenantProvisioningGeneration provisioningGeneration,
        LifecycleOperationId? currentOperationId,
        ResourceEventSequence lastEventSequence,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _id = id.Value;
        _currentOperationId = currentOperationId?.Value;
        DisplayName = displayName;
        Lifecycle = lifecycle;
        Revision = revision;
        ProvisioningGeneration = provisioningGeneration;
        LastEventSequence = lastEventSequence;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public TenantId Id => TenantId.FromStorage(_id);

    public TenantDisplayName DisplayName { get; internal set; } = null!;

    public LifecycleState Lifecycle { get; internal set; }

    public TenantRevision Revision { get; internal set; } = null!;

    public TenantProvisioningGeneration ProvisioningGeneration { get; internal set; } = null!;

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
