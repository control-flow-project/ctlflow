using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<ListPlacementsResponse> ListPlacements(
        ListPlacementsRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var target = await ParsePlacementTarget(
            request.Target,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.ReadPlacement,
            target,
            null,
            null,
            null,
            context.CancellationToken);
        var page = await PlacementDatabase.ListPlacements(
            _database,
            target,
            await ParsePageSize(
                request.PageSize,
                context.CancellationToken),
            request.HasAfterPlacementId
                ? PlacementId.Parse(request.AfterPlacementId)
                : null,
            context.CancellationToken);
        var response = new ListPlacementsResponse();
        foreach (var placement in page.Placements)
        {
            response.Placements.Add(await CreatePlacementResponse(
                placement,
                context.CancellationToken));
        }

        if (page.NextAfter is not null)
        {
            response.NextAfterPlacementId = page.NextAfter.Value;
        }

        return response;
    }
}
