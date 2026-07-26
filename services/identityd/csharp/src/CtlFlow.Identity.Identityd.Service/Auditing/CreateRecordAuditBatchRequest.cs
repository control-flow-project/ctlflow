using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal static partial class AuditDelivery
{
    private const ulong SourceSchemaGeneration = 1;

    internal static ValueTask<RecordAuditBatchRequest>
        CreateRecordAuditBatchRequest(
            SessionAuditIntent intent,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var request = new RecordAuditBatchRequest
        {
            SourceSchemaGeneration = SourceSchemaGeneration
        };
        request.Events.Add(new AuditEvent
        {
            SourceEventId = intent.EventId.Value,
            IdempotencyKey = intent.EventId.Value,
            Operation = intent.Action switch
            {
                SessionAuditAction.Created => "create_session",
                SessionAuditAction.Revoked => "revoke_session",
                _ => throw new InvalidOperationException(
                    "Session audit action is invalid")
            },
            OccurredAt = Timestamp.FromDateTimeOffset(
                intent.OccurredAt.Value),
            Attribution = new CtlFlow.Audit.V1.AuditAttribution
            {
                KubernetesSubject = intent.Caller.Value
            },
            Partition = new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = intent.TenantId.Value
                }
            },
            TraceId = intent.Correlation.TraceId,
            SpanId = intent.Correlation.SpanId,
            IdentitySession = new IdentitySessionAuditDetail
            {
                SessionId = intent.SessionId.Value,
                AccountPrincipalId = intent.AccountId.Value,
                SessionRevision = checked(
                    (ulong)intent.SessionRevision.Value),
                Action = intent.Action switch
                {
                    SessionAuditAction.Created =>
                        IdentitySessionAction.Created,
                    SessionAuditAction.Revoked =>
                        IdentitySessionAction.Revoked,
                    _ => throw new InvalidOperationException(
                        "Session audit action is invalid")
                }
            }
        });
        return ValueTask.FromResult(request);
    }
}
