using System.Diagnostics;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Auditing.AuditDelivery;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using static CtlFlow.Execution.Execd.Service.Workloads.WorkloadAdmission;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;
using WorkloadDatabase =
    CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Workload> DeclareWorkload(
        DeclareWorkloadRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var requested = await CreateWorkloadRequest(
            request,
            context.CancellationToken);
        var placement = await PlacementDatabase.GetPlacement(
            _database,
            requested.PlacementId,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.DeclareWorkload,
            placement.Target,
            placement.Id,
            requested.Id,
            null,
            context.CancellationToken);
        var admitted = await AdmitWorkload(
            _packageClient,
            _settings,
            _telemetry,
            placement,
            requested,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkloadDatabase.DeclareWorkload(
            _database,
            admitted.Draft,
            admitted.Content,
            placement.Revision,
            requested.ExpectedRevision,
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

        return await CreateWorkloadResponse(
            result.Record,
            context.CancellationToken);
    }
}
