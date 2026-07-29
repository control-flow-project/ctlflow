using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Placement> GetPlacement(
        GetPlacementRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var placementId = PlacementId.Parse(request.PlacementId);
        var placement = await PlacementDatabase.GetPlacement(
            _database,
            placementId,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.ReadPlacement,
            placement.Target,
            placementId,
            null,
            null,
            context.CancellationToken);
        return await CreatePlacementResponse(
            placement,
            context.CancellationToken);
    }
}
