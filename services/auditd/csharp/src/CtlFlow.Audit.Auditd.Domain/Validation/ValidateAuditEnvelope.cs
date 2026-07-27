using CtlFlow.Audit.Auditd.Domain.Events;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    internal static void ValidateAuditEnvelope(AuditEnvelope envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope.SourceSubject);
        ArgumentNullException.ThrowIfNull(envelope.SourceEventId);
        ArgumentNullException.ThrowIfNull(envelope.OccurredAt);
        ArgumentNullException.ThrowIfNull(envelope.Correlation);
        ArgumentNullException.ThrowIfNull(envelope.Attribution);
        ArgumentNullException.ThrowIfNull(envelope.Partition);
        ValidateAttribution(envelope.Attribution);
        ValidatePartition(envelope.Partition);
    }

    internal static void ValidatePlacementTarget(
        PlacementAuditTarget target)
    {
        ArgumentNullException.ThrowIfNull(target);
        switch (target.Kind)
        {
            case PlacementTargetKind.Global
                when target.TenantId is null
                    && target.WorkspaceId is null
                    && target.AccountPrincipalId is null:
                return;
            case PlacementTargetKind.Tenant
                when target.TenantId is not null
                    && target.WorkspaceId is null
                    && target.AccountPrincipalId is null:
                return;
            case PlacementTargetKind.Workspace
                when target.TenantId is not null
                    && target.WorkspaceId is not null
                    && target.AccountPrincipalId is null:
                return;
            case PlacementTargetKind.User
                when target.TenantId is not null
                    && target.WorkspaceId is null
                    && target.AccountPrincipalId is not null:
                return;
            default:
                throw new ArgumentException(
                    "Placement target is invalid");
        }
    }

    internal static void ValidateConsumerBinding(ConsumerBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);
        ArgumentNullException.ThrowIfNull(binding.PlacementId);
        ArgumentNullException.ThrowIfNull(binding.Target);
        ValidatePlacementTarget(binding.Target);
        ArgumentNullException.ThrowIfNull(binding.ConsumerId);
        ArgumentNullException.ThrowIfNull(binding.Purpose);
    }

    private static void ValidateAttribution(AuditAttribution attribution)
    {
        switch (attribution.Kind)
        {
            case AuditAttributionKind.Operator
                when attribution.OperatorCommonName is not null
                    && attribution.WorkloadSubject is null
                    && attribution.ActorPrincipalId is null
                    && attribution.AttachedAccountPrincipalId is null
                    && attribution.InvocationWorkloadSubject is null:
                return;
            case AuditAttributionKind.Workload
                when attribution.OperatorCommonName is null
                    && attribution.WorkloadSubject is not null
                    && attribution.ActorPrincipalId is null
                    && attribution.AttachedAccountPrincipalId is null
                    && attribution.InvocationWorkloadSubject is null:
                return;
            case AuditAttributionKind.Invocation
                when attribution.OperatorCommonName is null
                    && attribution.WorkloadSubject is null
                    && attribution.ActorPrincipalId is not null
                    && attribution.AttachedAccountPrincipalId is not null
                    && attribution.InvocationWorkloadSubject is not null:
                ValidateActorAttachment(
                    attribution.ActorPrincipalId,
                    attribution.AttachedAccountPrincipalId);
                return;
            default:
                throw new ArgumentException("Attribution is invalid");
        }
    }

    private static void ValidateActorAttachment(
        Principals.PrincipalId actorPrincipalId,
        Principals.AccountId attachedAccountPrincipalId)
    {
        if (actorPrincipalId.Kind != Principals.PrincipalKind.Virtual
            && !string.Equals(
                actorPrincipalId.Value,
                attachedAccountPrincipalId.Value,
                StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "Direct Actor must equal its attached account");
        }
    }

    private static void ValidatePartition(AuditPartition partition)
    {
        switch (partition.Kind)
        {
            case AuditPartitionKind.Global when partition.TenantId is null:
                return;
            case AuditPartitionKind.Tenant
                when partition.TenantId is not null:
                return;
            default:
                throw new ArgumentException("Audit partition is invalid");
        }
    }
}
