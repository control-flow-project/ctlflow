using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Targets;

public sealed record IdentityTarget(
    TenantId TenantId,
    WorkspaceId? WorkspaceId);
