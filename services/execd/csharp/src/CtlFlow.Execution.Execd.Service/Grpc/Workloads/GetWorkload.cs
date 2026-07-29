using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;
using WorkloadDatabase =
    CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Workload> GetWorkload(
        GetWorkloadRequest request,
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
            Authorization.ExecdCapability.ReadWorkload,
            placement.Target,
            placement.Id,
            workloadId,
            null,
            context.CancellationToken);
        return await CreateWorkloadResponse(
            workload,
            context.CancellationToken);
    }
}
