using System.Diagnostics;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Auditing.AuditDelivery;
using static CtlFlow.Execution.Execd.Service.Authorization.ExecutionAuthorization;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using PlacementDatabase =
    CtlFlow.Execution.Execd.Db.Placements.Placements;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    public override async Task<Placement> DeclarePlacement(
        DeclarePlacementRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateRequest(context);
        var draft = await CreatePlacementDraft(
            request,
            _settings.Provisioners,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ExecdCapability.DeclarePlacement,
            draft.Target,
            draft.Id,
            null,
            null,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await PlacementDatabase.DeclarePlacement(
            _database,
            draft.Id,
            draft.Target,
            draft.ParentId,
            draft.Constraints,
            draft.DesiredState,
            draft.ExpectedRevision,
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

        return await CreatePlacementResponse(
            result.Record,
            context.CancellationToken);
    }
}
