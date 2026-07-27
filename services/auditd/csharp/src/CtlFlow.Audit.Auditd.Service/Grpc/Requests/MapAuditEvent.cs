using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Sources;
using CtlFlow.Audit.Auditd.Domain.Time;
using CtlFlow.Audit.Auditd.Service.Security;
using CtlFlow.Audit.V1;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditRecords;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    internal static async ValueTask<AuditRecord> MapAuditEvent(
        AuditSourceIdentity source,
        AuditEvent value,
        CancellationToken cancellation)
    {
        var timestamp = value.OccurredAt
            ?? throw new ArgumentException(
                "Occurrence timestamp is required");
        var envelope = new AuditEnvelope(
            source.Source,
            await WorkloadSubject.Parse(
                source.Subject.Value,
                cancellation),
            await AuditEventId.Parse(value.SourceEventId, cancellation),
            await AuditTimestamp.Parse(
                timestamp.Seconds,
                timestamp.Nanos,
                cancellation),
            await MapAuditAttribution(
                value.Attribution,
                cancellation),
            await MapAuditPartition(value.Partition, cancellation),
            await AuditCorrelation.Parse(
                value.TraceId,
                value.SpanId,
                cancellation));
        var detail = await MapAuditDetail(value, cancellation);
        return await CreateAuditRecord(envelope, detail, cancellation);
    }
}
