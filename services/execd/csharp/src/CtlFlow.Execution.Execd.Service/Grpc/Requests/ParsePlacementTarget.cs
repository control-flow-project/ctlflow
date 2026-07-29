using CtlFlow.Execution.Execd.Domain.Identifiers;
using DomainPlacementTarget =
    CtlFlow.Execution.Execd.Domain.Placements.PlacementTarget;
using WirePlacementTarget =
    CtlFlow.Execution.V1.PlacementTarget;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static ValueTask<DomainPlacementTarget> ParsePlacementTarget(
        WirePlacementTarget? target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (target is null)
        {
            throw new ArgumentException("target is required");
        }

        DomainPlacementTarget result = target.LevelCase switch
        {
            WirePlacementTarget.LevelOneofCase.Global =>
                new DomainPlacementTarget.Global(),
            WirePlacementTarget.LevelOneofCase.Tenant =>
                new DomainPlacementTarget.Tenant(
                    TenantId.Parse(target.Tenant.TenantId)),
            WirePlacementTarget.LevelOneofCase.Workspace =>
                new DomainPlacementTarget.Workspace(
                    TenantId.Parse(target.Workspace.TenantId),
                    WorkspaceId.Parse(target.Workspace.WorkspaceId)),
            WirePlacementTarget.LevelOneofCase.User =>
                new DomainPlacementTarget.User(
                    TenantId.Parse(target.User.TenantId),
                    PrincipalId.ParseAccount(
                        target.User.AccountPrincipalId)),
            _ => throw new ArgumentException(
                "target must contain exactly one level")
        };
        return ValueTask.FromResult(result);
    }
}
