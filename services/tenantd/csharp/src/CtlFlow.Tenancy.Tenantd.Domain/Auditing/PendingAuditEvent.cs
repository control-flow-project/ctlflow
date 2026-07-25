using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record PendingAuditEvent(
    AuditSourceEventId SourceEventId,
    ResourceEventSequence SourceSequence,
    IdempotencyKey IdempotencyKey,
    AuditOperationName Operation,
    UtcInstant OccurredAt,
    RequestActor OperatorSubject,
    RequestActor? ImmediateCaller,
    AuditResourceTarget Target,
    AuditResourceRevision ResourceRevision,
    AuditCorrelation Correlation,
    AuditDeliveryAttempt DeliveryAttempt);
