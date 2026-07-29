using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;
using RunDatabase =
    CtlFlow.Execution.Execd.Db.Runs.Runs;
using WorkloadDatabase =
    CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<ListRunsResponse> ListRuns(
        ListRunsRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var workloadId = WorkloadId.Parse(request.WorkloadId);
        var workload = await WorkloadDatabase.GetWorkload(
            _database,
            workloadId,
            context.CancellationToken);
        var placement = await PlacementDatabase.GetPlacement(
            _database,
            workload.PlacementId,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.ReadRun,
            placement.Target,
            placement.Id,
            workloadId,
            null,
            context.CancellationToken);
        var page = await RunDatabase.ListRuns(
            _database,
            workloadId,
            await ParsePageSize(
                request.PageSize,
                context.CancellationToken),
            request.HasAfterRunId
                ? RunId.Parse(request.AfterRunId)
                : null,
            context.CancellationToken);
        var response = new ListRunsResponse();
        foreach (var run in page.Runs)
        {
            response.Runs.Add(await CreateRunResponse(
                run,
                context.CancellationToken));
        }

        if (page.NextAfter is not null)
        {
            response.NextAfterRunId = page.NextAfter.Value;
        }

        return response;
    }
}
