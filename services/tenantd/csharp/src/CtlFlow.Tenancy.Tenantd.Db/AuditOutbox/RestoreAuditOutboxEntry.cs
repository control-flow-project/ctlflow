namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    private static AuditOutboxEntry RestoreAuditOutboxEntry(
        AuditOutboxRow row) =>
        new(
            row.OutboxId,
            row.SourceEventId,
            row.SourceSequence,
            row.OperatorSubject,
            row.ImmediateCaller,
            row.OperationName,
            row.ResourceKind,
            row.TenantId,
            row.WorkspaceId,
            row.ResourceId,
            row.ResourceRevision,
            row.IdempotencyKey,
            row.OccurredAtUnixMilliseconds,
            row.TraceId,
            row.SpanId,
            row.DeliveryState,
            row.DeliveryAttempts,
            row.Revision,
            row.AvailableAtUnixMilliseconds,
            row.LeaseId,
            row.LeaseExpiresAtUnixMilliseconds,
            row.FailureCode);

}

internal sealed record AuditOutboxRow(
    string OutboxId,
    string SourceEventId,
    long SourceSequence,
    string OperatorSubject,
    string? ImmediateCaller,
    string OperationName,
    int ResourceKind,
    string TenantId,
    string? WorkspaceId,
    string ResourceId,
    long ResourceRevision,
    string IdempotencyKey,
    long OccurredAtUnixMilliseconds,
    string TraceId,
    string SpanId,
    int DeliveryState,
    int DeliveryAttempts,
    long Revision,
    long AvailableAtUnixMilliseconds,
    string? LeaseId,
    long? LeaseExpiresAtUnixMilliseconds,
    int? FailureCode);
