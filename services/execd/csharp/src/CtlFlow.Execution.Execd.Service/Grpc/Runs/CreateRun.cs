using System.Diagnostics;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Auditing.AuditDelivery;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
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
    public override async Task<Run> CreateRun(
        CreateRunRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var runId = RunId.Parse(request.RunId);
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
            Authorization.ExecdCapability.CreateRun,
            placement.Target,
            placement.Id,
            workloadId,
            runId,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await RunDatabase.CreateRun(
            _database,
            runId,
            workloadId,
            audit,
            context.CancellationToken);
        if (result.Audit is not null)
        {
            await RecordAudit(
                _auditClient,
                _settings.Audit,
                _telemetry,
                result.Audit,
                context.CancellationToken);
        }

        return await CreateRunResponse(
            result.Record,
            context.CancellationToken);
    }
}
