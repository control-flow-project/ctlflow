namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed record AuditAcceptance(
    AuditEventId SourceEventId,
    PartitionCursor PartitionCursor);

public sealed record AuditBatchResult(
    IReadOnlyList<AuditAcceptance> Acceptances,
    int NewEventCount,
    int ReplayCount);
