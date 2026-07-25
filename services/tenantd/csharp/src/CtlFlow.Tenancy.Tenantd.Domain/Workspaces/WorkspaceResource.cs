using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceResource(
    WorkspaceId WorkspaceId,
    TenantId TenantId,
    WorkspaceDisplayName DisplayName,
    WorkspaceAddress Address,
    IReadOnlyList<InitialWorkspaceMembershipIntent> InitialMemberships,
    IReadOnlyList<BaselinePackageIntent> BaselinePackages,
    LifecycleState Lifecycle,
    WorkspaceRevision Revision,
    WorkspaceProvisioningGeneration ProvisioningGeneration,
    LifecycleOperationId? CurrentOperationId,
    LifecycleOperationKind? CurrentOperationKind,
    IReadOnlyList<LifecycleCondition> Conditions,
    ResourceEventSequence ResourceVersion,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
