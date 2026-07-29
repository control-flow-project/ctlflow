using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;
using WorkloadDatabase =
    CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<ListWorkloadsResponse> ListWorkloads(
        ListWorkloadsRequest request,
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
            Authorization.ExecdCapability.ReadWorkload,
            placement.Target,
            placementId,
            null,
            null,
            context.CancellationToken);
        var page = await WorkloadDatabase.ListWorkloads(
            _database,
            placementId,
            await ParsePageSize(
                request.PageSize,
                context.CancellationToken),
            request.HasAfterWorkloadId
                ? WorkloadId.Parse(request.AfterWorkloadId)
                : null,
            context.CancellationToken);
        var response = new ListWorkloadsResponse();
        foreach (var workload in page.Workloads)
        {
            response.Workloads.Add(await CreateWorkloadResponse(
                workload,
                context.CancellationToken));
        }

        if (page.NextAfter is not null)
        {
            response.NextAfterWorkloadId = page.NextAfter.Value;
        }

        return response;
    }
}
