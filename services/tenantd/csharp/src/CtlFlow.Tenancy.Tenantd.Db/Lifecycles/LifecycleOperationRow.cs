using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal sealed record LifecycleOperationRow(
    string OperationId,
    int TargetKind,
    string TenantId,
    string? WorkspaceId,
    LifecycleOperationKind Kind,
    LifecycleState DesiredLifecycle,
    long ProvisioningGeneration,
    LifecycleOperationState State,
    RequestActor RequestActor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
