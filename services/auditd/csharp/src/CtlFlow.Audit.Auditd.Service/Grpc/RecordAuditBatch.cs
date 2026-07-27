using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.V1;
using Grpc.Core;
using AuditEventPersistence =
    CtlFlow.Audit.Auditd.Db.Events.AuditEvents;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditRecords;
using static CtlFlow.Audit.Auditd.Service.Grpc.Requests.AuditRequests;
using static CtlFlow.Audit.Auditd.Service.Security.AuditSourceAuthentication;

namespace CtlFlow.Audit.Auditd.Service.Grpc;

internal sealed partial class AuditGrpcService
{
    public override async Task<RecordAuditBatchResponse> RecordAuditBatch(
        RecordAuditBatchRequest request,
        ServerCallContext context)
    {
        var source = await AuthenticateAuditSource(
            context.RequestHeaders,
            _settings.WorkloadTokens.Validation,
            _verificationKeys,
            _settings.Sources,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        if (request.Events.Count > 100)
        {
            throw new AuditBatchLimitException();
        }

        var records = new List<AuditRecord>(request.Events.Count);
        foreach (var auditEvent in request.Events)
        {
            records.Add(await MapAuditEvent(
                source,
                auditEvent,
                context.CancellationToken));
        }

        await ValidateAuditBatch(records, context.CancellationToken);
        var result = await AuditEventPersistence.RecordAuditBatch(
            _auditDatabase,
            records,
            context.CancellationToken);
        _telemetry.RecordAcceptedBatch(source.Source, records, result);

        var response = new RecordAuditBatchResponse();
        foreach (var acceptance in result.Acceptances)
        {
            response.Acceptances.Add(new CtlFlow.Audit.V1.AuditAcceptance
            {
                SourceEventId = acceptance.SourceEventId.Value,
                PartitionCursor = checked(
                    (ulong)acceptance.PartitionCursor.Value)
            });
        }

        return response;
    }
}
