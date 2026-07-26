using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceMappings
{
    internal static WorkspaceDetails CreateWorkspaceDetails(
        string workspaceId,
        string tenantId,
        string address,
        DisplayName displayName,
        ResourceState state,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt) =>
        new(
            WorkspaceId.FromStorage(workspaceId),
            TenantId.FromStorage(tenantId),
            ResourceAddress.FromStorage(address),
            displayName,
            state,
            revision,
            createdAt,
            updatedAt);
}
