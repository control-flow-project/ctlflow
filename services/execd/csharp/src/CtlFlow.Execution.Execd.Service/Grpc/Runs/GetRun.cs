using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using RunDatabase =
    CtlFlow.Execution.Execd.Db.Runs.Runs;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Run> GetRun(
        GetRunRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var runId = RunId.Parse(request.RunId);
        var run = await RunDatabase.GetRun(
            _database,
            runId,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.ReadRun,
            run.Target,
            run.PlacementId,
            run.WorkloadId,
            runId,
            context.CancellationToken);
        return await CreateRunResponse(
            run,
            context.CancellationToken);
    }
}
