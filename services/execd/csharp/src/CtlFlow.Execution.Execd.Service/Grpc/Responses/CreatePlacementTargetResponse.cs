using DomainPlacementTarget =
    CtlFlow.Execution.Execd.Domain.Placements.PlacementTarget;
using WirePlacementTarget =
    CtlFlow.Execution.V1.PlacementTarget;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static WirePlacementTarget CreatePlacementTargetResponse(
        DomainPlacementTarget target) =>
        target switch
        {
            DomainPlacementTarget.Global => new WirePlacementTarget
            {
                Global = new()
            },
            DomainPlacementTarget.Tenant tenant =>
                new WirePlacementTarget
                {
                    Tenant = new()
                    {
                        TenantId = tenant.TenantId.Value
                    }
                },
            DomainPlacementTarget.Workspace workspace =>
                new WirePlacementTarget
                {
                    Workspace = new()
                    {
                        TenantId = workspace.TenantId.Value,
                        WorkspaceId = workspace.WorkspaceId.Value
                    }
                },
            DomainPlacementTarget.User user =>
                new WirePlacementTarget
                {
                    User = new()
                    {
                        TenantId = user.TenantId.Value,
                        AccountPrincipalId =
                            user.AccountPrincipalId.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Placement target is invalid")
        };
}
