namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditCorrelation(
    AuditTraceId TraceId,
    AuditSpanId SpanId);
