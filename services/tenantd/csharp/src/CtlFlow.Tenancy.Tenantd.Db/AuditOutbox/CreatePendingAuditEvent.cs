using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    private static PendingAuditEvent CreatePendingAuditEvent(
        AuditOutboxRow row)
    {
        var tenantId = TenantId.FromStorage(row.TenantId);
        AuditResourceTarget target = row.ResourceKind switch
        {
            1 when row.WorkspaceId is null
                && row.ResourceId == row.TenantId =>
                new AuditResourceTarget.Tenant(tenantId),
            2 when row.WorkspaceId is not null
                && row.ResourceId == row.WorkspaceId =>
                new AuditResourceTarget.Workspace(
                    tenantId,
                    WorkspaceId.FromStorage(row.WorkspaceId)),
            _ => throw new InvalidOperationException(
                "Stored audit resource target is invalid")
        };

        return new PendingAuditEvent(
            AuditSourceEventId.FromStorage(row.SourceEventId),
            ResourceEventSequence.FromStorage(row.SourceSequence),
            IdempotencyKey.FromStorage(row.IdempotencyKey),
            AuditOperationName.FromStorage(row.OperationName),
            UtcInstant.FromStorage(row.OccurredAtUnixMilliseconds),
            RequestActor.FromStorage(row.OperatorSubject),
            row.ImmediateCaller is null
                ? null
                : RequestActor.FromStorage(row.ImmediateCaller),
            target,
            AuditResourceRevision.FromStorage(row.ResourceRevision),
            new AuditCorrelation(
                AuditTraceId.FromStorage(row.TraceId),
                AuditSpanId.FromStorage(row.SpanId)),
            AuditDeliveryAttempt.FromStorage(row.DeliveryAttempts + 1));
    }
}
