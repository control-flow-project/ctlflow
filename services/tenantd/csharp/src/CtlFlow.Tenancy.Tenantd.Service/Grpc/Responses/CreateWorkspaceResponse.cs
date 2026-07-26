using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class TenancyResponses
{
    internal static CtlFlow.Tenancy.V1.Workspace CreateWorkspaceResponse(
        WorkspaceDetails workspace) =>
        new()
        {
            WorkspaceId = workspace.WorkspaceId.Value,
            TenantId = workspace.TenantId.Value,
            Address = workspace.Address.Value,
            DisplayName = workspace.DisplayName.Value,
            State = MapResourceState(workspace.State),
            Revision = checked((ulong)workspace.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(
                workspace.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(
                workspace.UpdatedAt.Value)
        };
}
