namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public class AuditOutboxEntry
{
    private AuditOutboxEntry()
    {
    }

    internal AuditOutboxEntry(
        string outboxId,
        string sourceEventId,
        long sourceSequence,
        string operatorSubject,
        string? immediateCaller,
        string operationName,
        int resourceKind,
        string tenantId,
        string? workspaceId,
        string resourceId,
        long resourceRevision,
        string idempotencyKey,
        long occurredAtUnixMilliseconds,
        string traceId,
        string spanId)
        : this(
            outboxId,
            sourceEventId,
            sourceSequence,
            operatorSubject,
            immediateCaller,
            operationName,
            resourceKind,
            tenantId,
            workspaceId,
            resourceId,
            resourceRevision,
            idempotencyKey,
            occurredAtUnixMilliseconds,
            traceId,
            spanId,
            1,
            0,
            1,
            occurredAtUnixMilliseconds,
            null,
            null,
            null)
    {
    }

    internal AuditOutboxEntry(
        string outboxId,
        string sourceEventId,
        long sourceSequence,
        string operatorSubject,
        string? immediateCaller,
        string operationName,
        int resourceKind,
        string tenantId,
        string? workspaceId,
        string resourceId,
        long resourceRevision,
        string idempotencyKey,
        long occurredAtUnixMilliseconds,
        string traceId,
        string spanId,
        int deliveryState,
        int deliveryAttempts,
        long revision,
        long availableAtUnixMilliseconds,
        string? leaseId,
        long? leaseExpiresAtUnixMilliseconds,
        int? failureCode)
    {
        OutboxId = outboxId;
        SourceEventId = sourceEventId;
        SourceSequence = sourceSequence;
        OperatorSubject = operatorSubject;
        ImmediateCaller = immediateCaller;
        OperationName = operationName;
        ResourceKind = resourceKind;
        TenantId = tenantId;
        WorkspaceId = workspaceId;
        ResourceId = resourceId;
        ResourceRevision = resourceRevision;
        IdempotencyKey = idempotencyKey;
        OccurredAtUnixMilliseconds = occurredAtUnixMilliseconds;
        TraceId = traceId;
        SpanId = spanId;
        DeliveryState = deliveryState;
        DeliveryAttempts = deliveryAttempts;
        Revision = revision;
        AvailableAtUnixMilliseconds = availableAtUnixMilliseconds;
        LeaseId = leaseId;
        LeaseExpiresAtUnixMilliseconds = leaseExpiresAtUnixMilliseconds;
        FailureCode = failureCode;
    }

    public string OutboxId { get; private set; } = string.Empty;
    public string SourceEventId { get; private set; } = string.Empty;
    public long SourceSequence { get; private set; }
    public string OperatorSubject { get; private set; } = string.Empty;
    public string? ImmediateCaller { get; private set; }
    public string OperationName { get; private set; } = string.Empty;
    public int ResourceKind { get; private set; }
    public string TenantId { get; private set; } = string.Empty;
    public string? WorkspaceId { get; private set; }
    public string ResourceId { get; private set; } = string.Empty;
    public long ResourceRevision { get; private set; }
    public string IdempotencyKey { get; private set; } = string.Empty;
    public long OccurredAtUnixMilliseconds { get; private set; }
    public string TraceId { get; private set; } = string.Empty;
    public string SpanId { get; private set; } = string.Empty;
    public int DeliveryState { get; internal set; }
    public int DeliveryAttempts { get; internal set; }
    public long Revision { get; internal set; }
    public long AvailableAtUnixMilliseconds { get; internal set; }
    public string? LeaseId { get; internal set; }
    public long? LeaseExpiresAtUnixMilliseconds { get; internal set; }
    public int? FailureCode { get; internal set; }
}
