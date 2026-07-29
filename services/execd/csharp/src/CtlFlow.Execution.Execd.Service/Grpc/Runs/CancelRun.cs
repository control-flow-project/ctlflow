using System.Diagnostics;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Auditing.AuditDelivery;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using RunDatabase =
    CtlFlow.Execution.Execd.Db.Runs.Runs;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Run> CancelRun(
        CancelRunRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var runId = RunId.Parse(request.RunId);
        var current = await RunDatabase.GetRun(
            _database,
            runId,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.CancelRun,
            current.Target,
            current.PlacementId,
            current.WorkloadId,
            runId,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await RunDatabase.CancelRun(
            _database,
            runId,
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
