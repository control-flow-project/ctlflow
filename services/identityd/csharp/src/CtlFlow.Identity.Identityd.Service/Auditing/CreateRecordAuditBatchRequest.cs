using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<RecordAuditBatchRequest>
        CreateRecordAuditBatchRequest(
            IdentityAuditIntent intent,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var auditEvent = new AuditEvent
        {
            SourceEventId = intent.EventId.Value,
            OccurredAt = Timestamp.FromDateTimeOffset(
                intent.OccurredAt.Value),
            Attribution = CreateAuditAttribution(intent.Attribution),
            Partition = new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = intent.TenantId.Value
                }
            },
            TraceId = intent.Correlation.TraceId,
            SpanId = intent.Correlation.SpanId
        };
        SetAuditDetail(auditEvent, intent);
        var request = new RecordAuditBatchRequest();
        request.Events.Add(auditEvent);
        return ValueTask.FromResult(request);
    }
}
