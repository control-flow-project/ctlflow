using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public class LifecycleOperation
{
    private string _operationId = string.Empty;
    private string _tenantId = string.Empty;
    private string? _workspaceId;

    private LifecycleOperation()
    {
    }

    internal LifecycleOperation(
        LifecycleOperationId operationId,
        LifecycleTarget target,
        LifecycleOperationKind kind,
        long provisioningGeneration,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        RequestDigest requestDigest,
        UtcInstant now)
    {
        _operationId = operationId.Value;
        _tenantId = target switch
        {
            LifecycleTarget.Tenant tenant => tenant.TenantId.Value,
            LifecycleTarget.Workspace workspace => workspace.TenantId.Value,
            _ => throw new InvalidOperationException(
                "Lifecycle target is invalid")
        };
        _workspaceId = target is LifecycleTarget.Workspace workspaceTarget
            ? workspaceTarget.WorkspaceId.Value
            : null;
        TargetKind = target is LifecycleTarget.Tenant ? 1 : 2;
        Kind = kind;
        DesiredLifecycle = kind switch
        {
            LifecycleOperationKind.Provision => LifecycleState.Active,
            LifecycleOperationKind.Suspend => LifecycleState.Suspended,
            LifecycleOperationKind.Resume => LifecycleState.Active,
            LifecycleOperationKind.Delete => LifecycleState.Deleted,
            _ => throw new InvalidOperationException(
                "Lifecycle operation is invalid")
        };
        ProvisioningGeneration = provisioningGeneration;
        State = LifecycleOperationState.Pending;
        RequestActor = actor;
        IdempotencyKey = idempotencyKey;
        RequestDigest = requestDigest;
        CreatedAt = now;
        UpdatedAt = now;
    }

    internal LifecycleOperation(
        LifecycleOperationId operationId,
        LifecycleTarget target,
        LifecycleOperationKind kind,
        LifecycleState desiredLifecycle,
        long provisioningGeneration,
        LifecycleOperationState state,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        RequestDigest requestDigest,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _operationId = operationId.Value;
        _tenantId = target switch
        {
            LifecycleTarget.Tenant tenant => tenant.TenantId.Value,
            LifecycleTarget.Workspace workspace => workspace.TenantId.Value,
            _ => throw new InvalidOperationException(
                "Lifecycle target is invalid")
        };
        _workspaceId = target is LifecycleTarget.Workspace workspaceTarget
            ? workspaceTarget.WorkspaceId.Value
            : null;
        TargetKind = target is LifecycleTarget.Tenant ? 1 : 2;
        Kind = kind;
        DesiredLifecycle = desiredLifecycle;
        ProvisioningGeneration = provisioningGeneration;
        State = state;
        RequestActor = actor;
        IdempotencyKey = idempotencyKey;
        RequestDigest = requestDigest;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public LifecycleOperationId Id =>
        LifecycleOperationId.FromStorage(_operationId);

    public LifecycleTarget Target =>
        TargetKind == 1
            ? new LifecycleTarget.Tenant(TenantId.FromStorage(_tenantId))
            : new LifecycleTarget.Workspace(
                TenantId.FromStorage(_tenantId),
                WorkspaceId.FromStorage(_workspaceId!));

    internal int TargetKind { get; private set; }

    public LifecycleOperationKind Kind { get; private set; }

    public LifecycleState DesiredLifecycle { get; private set; }

    public long ProvisioningGeneration { get; private set; }

    public LifecycleOperationState State { get; internal set; }

    public RequestActor RequestActor { get; private set; } = null!;

    public IdempotencyKey IdempotencyKey { get; private set; } = null!;

    public RequestDigest RequestDigest { get; private set; } = null!;

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; internal set; } = null!;
}
