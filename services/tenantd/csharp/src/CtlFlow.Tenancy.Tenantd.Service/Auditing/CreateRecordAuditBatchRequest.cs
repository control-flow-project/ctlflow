using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    private const ulong SourceSchemaGeneration = 1;

    internal static RecordAuditBatchRequest CreateRecordAuditBatchRequest(
        AuditOutboxLease lease)
    {
        var request = new RecordAuditBatchRequest
        {
            SourceSchemaGeneration = SourceSchemaGeneration
        };
        foreach (var pending in lease.Events)
        {
            request.Events.Add(CreateAuditEvent(pending));
        }

        return request;
    }

    private static AuditEvent CreateAuditEvent(PendingAuditEvent pending)
    {
        var attribution = new AuditAttribution
        {
            KubernetesSubject = pending.OperatorSubject.Value
        };
        if (pending.ImmediateCaller is not null)
        {
            attribution.ImmediateCaller =
                pending.ImmediateCaller.Value;
        }

        var tenantId = pending.Target switch
        {
            AuditResourceTarget.Tenant tenant => tenant.TenantId,
            AuditResourceTarget.Workspace workspace => workspace.TenantId,
            _ => throw new InvalidOperationException(
                "Audit target is invalid")
        };
        var detail = new TenancyMutationAuditDetail
        {
            ResourceRevision =
                checked((ulong)pending.ResourceRevision.Value),
            Outcome = AuditOutcome.Succeeded
        };
        switch (pending.Target)
        {
            case AuditResourceTarget.Tenant tenant:
                detail.Tenant = new TenantAuditTarget
                {
                    TenantId = tenant.TenantId.Value
                };
                break;
            case AuditResourceTarget.Workspace workspace:
                detail.Workspace = new WorkspaceAuditTarget
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Audit target is invalid");
        }

        return new AuditEvent
        {
            SourceEventId = pending.SourceEventId.Value,
            SourceSequence = checked((ulong)pending.SourceSequence.Value),
            IdempotencyKey = pending.IdempotencyKey.Value,
            Operation = pending.Operation.Value,
            OccurredAt = Timestamp.FromDateTimeOffset(
                pending.OccurredAt.Value),
            Attribution = attribution,
            Partition = new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = tenantId.Value
                }
            },
            TraceId = pending.Correlation.TraceId.Value,
            SpanId = pending.Correlation.SpanId.Value,
            TenancyMutation = detail
        };
    }
}
