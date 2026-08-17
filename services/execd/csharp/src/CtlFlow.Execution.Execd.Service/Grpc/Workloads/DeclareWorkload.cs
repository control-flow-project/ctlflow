using System.Diagnostics;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
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
using WorkloadRecord =
    CtlFlow.Execution.Execd.Domain.Workloads.WorkloadRecord;

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
        WorkloadRecord? current = null;
        try
        {
            current = await WorkloadDatabase.GetWorkload(
                _database,
                requested.Id,
                context.CancellationToken);
        }
        catch (ExecutionException exception) when (
            exception.Error == ExecutionError.NotFound)
        {
        }

        var retainedPackage = current?.AdmittedPackage;
        if (retainedPackage is not null
            && (retainedPackage.AppId
                    != requested.PackageComponent.AppId
                || retainedPackage.ComponentId
                    != requested.PackageComponent.ComponentId))
        {
            retainedPackage = null;
        }

        var admitted = await AdmitWorkload(
            _packageClient,
            _settings,
            _telemetry,
            placement,
            requested,
            retainedPackage,
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
