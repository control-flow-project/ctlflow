using CtlFlow.Audit.Auditd.Domain.Configurations;
using CtlFlow.Audit.Auditd.Domain.Consumers;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Secrets;
using CtlFlow.Audit.Auditd.Domain.Sources;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Time;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed record AuditEnvelope(
    AuditSource Source,
    WorkloadSubject SourceSubject,
    AuditEventId SourceEventId,
    AuditTimestamp OccurredAt,
    AuditAttribution Attribution,
    AuditPartition Partition,
    AuditCorrelation Correlation);

public sealed record AuditAttribution(
    AuditAttributionKind Kind,
    OperatorCommonName? OperatorCommonName,
    WorkloadSubject? WorkloadSubject,
    PrincipalId? ActorPrincipalId,
    AccountId? AttachedAccountPrincipalId,
    WorkloadSubject? InvocationWorkloadSubject);

public sealed record AuditPartition(
    AuditPartitionKind Kind,
    TenantId? TenantId)
{
    internal string Key => Kind switch
    {
        AuditPartitionKind.Global => "global",
        AuditPartitionKind.Tenant => $"tenant:{TenantId?.Value}",
        _ => throw new InvalidOperationException("Unknown audit partition")
    };
}

public sealed record PlacementAuditTarget(
    PlacementTargetKind Kind,
    TenantId? TenantId,
    WorkspaceId? WorkspaceId,
    AccountId? AccountPrincipalId);

public sealed record ConsumerBinding(
    PlacementId PlacementId,
    PlacementAuditTarget Target,
    ConsumerId ConsumerId,
    ConsumerPurpose Purpose);

public sealed record ProjectionAuditTarget(
    ProjectionTargetKind Kind,
    ConfigurationId? ConfigurationId,
    ConfigurationVersionId? ConfigurationVersionId,
    SecretId? SecretId,
    SecretVersionId? SecretVersionId);
