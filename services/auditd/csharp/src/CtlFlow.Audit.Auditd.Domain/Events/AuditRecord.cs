using CtlFlow.Audit.Auditd.Domain.Sources;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;
using static CtlFlow.Audit.Auditd.Domain.Sources.AuditSources;

namespace CtlFlow.Audit.Auditd.Domain.Events;

public class AuditRecord
{
    private AuditRecord()
    {
        EventKey = null!;
        SourcePrincipal = null!;
        SourceSubject = null!;
        SourceEventId = null!;
        PartitionKey = null!;
        TraceId = null!;
        SpanId = null!;
        ContentHash = null!;
        Detail = null!;
    }

    internal AuditRecord(AuditEnvelope envelope, AuditDetail detail)
    {
        SourcePrincipal = ToPrincipal(envelope.Source);
        SourceSubject = envelope.SourceSubject.Value;
        SourceEventId = envelope.SourceEventId.Value;
        EventKey = CalculateEventKey(SourcePrincipal, SourceEventId);
        detail.AttachTo(EventKey);
        OccurredAtSeconds = envelope.OccurredAt.Seconds;
        OccurredAtNanoseconds = envelope.OccurredAt.Nanoseconds;
        AttributionKind = envelope.Attribution.Kind;
        OperatorCommonName =
            envelope.Attribution.OperatorCommonName?.Value;
        WorkloadSubject = envelope.Attribution.WorkloadSubject?.Value;
        ActorPrincipalId = envelope.Attribution.ActorPrincipalId?.Value;
        AttachedAccountPrincipalId =
            envelope.Attribution.AttachedAccountPrincipalId?.Value;
        InvocationWorkloadSubject =
            envelope.Attribution.InvocationWorkloadSubject?.Value;
        PartitionKind = envelope.Partition.Kind;
        PartitionTenantId = envelope.Partition.TenantId?.Value;
        PartitionKey = envelope.Partition.Key;
        TraceId = envelope.Correlation.TraceId;
        SpanId = envelope.Correlation.SpanId;
        DetailKind = detail.Kind;
        ContentHash = CalculateCanonicalHash(envelope, detail);
        Detail = detail;
    }

    internal string EventKey { get; private set; }

    internal string SourcePrincipal { get; private set; }

    internal AuditSource Source => FromPrincipal(SourcePrincipal);

    internal string SourceSubject { get; private set; }

    internal string SourceEventId { get; private set; }

    internal long OccurredAtSeconds { get; private set; }

    internal int OccurredAtNanoseconds { get; private set; }

    internal AuditAttributionKind AttributionKind { get; private set; }

    internal string? OperatorCommonName { get; private set; }

    internal string? WorkloadSubject { get; private set; }

    internal string? ActorPrincipalId { get; private set; }

    internal string? AttachedAccountPrincipalId { get; private set; }

    internal string? InvocationWorkloadSubject { get; private set; }

    public AuditPartitionKind PartitionKind { get; private set; }

    internal string? PartitionTenantId { get; private set; }

    internal string PartitionKey { get; private set; }

    internal string TraceId { get; private set; }

    internal string SpanId { get; private set; }

    public AuditDetailKind DetailKind { get; private set; }

    internal string ContentHash { get; private set; }

    internal long AcceptedAtSeconds { get; private set; }

    internal int AcceptedAtNanoseconds { get; private set; }

    internal long PartitionCursor { get; private set; }

    internal AuditDetail Detail { get; private set; }

    internal void Accept(
        long partitionCursor,
        long acceptedAtSeconds,
        int acceptedAtNanoseconds)
    {
        if (PartitionCursor != 0
            || partitionCursor <= 0
            || acceptedAtNanoseconds is < 0 or > 999_999_999)
        {
            throw new InvalidOperationException(
                "Audit acceptance is invalid");
        }

        PartitionCursor = partitionCursor;
        AcceptedAtSeconds = acceptedAtSeconds;
        AcceptedAtNanoseconds = acceptedAtNanoseconds;
    }
}
