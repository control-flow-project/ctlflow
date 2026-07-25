using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record CreateWorkspaceCommand(
    TenantId TenantId,
    WorkspaceDisplayName DisplayName,
    WorkspaceAddress Address,
    IReadOnlyList<InitialWorkspaceMembershipIntent> InitialMemberships,
    IReadOnlyList<BaselinePackageIntent> BaselinePackages,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
