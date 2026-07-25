namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditOutboxLease(
    AuditLeaseId LeaseId,
    IReadOnlyList<PendingAuditEvent> Events);
