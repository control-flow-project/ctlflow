using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Sources;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    internal static void ValidateSourceAdmission(
        AuditEnvelope envelope,
        AuditDetail detail)
    {
        switch (envelope.Source, detail)
        {
            case (AuditSource.Tenantd, TenantMutationAuditDetail tenant):
                ValidateTenantSource(envelope, tenant);
                return;
            case (AuditSource.Tenantd, WorkspaceMutationAuditDetail):
                RequireTenantPartition(envelope.Partition);
                RequireAttribution(
                    envelope.Attribution,
                    AuditAttributionKind.Operator,
                    AuditAttributionKind.Invocation);
                return;
            case (AuditSource.Identityd, IdentitySessionAuditDetail):
                RequireTenantPartition(envelope.Partition);
                RequireAttribution(
                    envelope.Attribution,
                    AuditAttributionKind.Workload);
                return;
            case (AuditSource.Pkgd, PackageDeclarationAuditDetail):
                RequireGlobalPartition(envelope.Partition);
                RequireAttribution(
                    envelope.Attribution,
                    AuditAttributionKind.Operator);
                return;
            case (AuditSource.Pkgd, AppMutationAuditDetail app):
                ValidateTargetPartition(envelope.Partition, app.Scope);
                RequireOperatorForGlobal(
                    envelope.Attribution,
                    app.Scope);
                return;
            case (
                AuditSource.Configd,
                ConfigurationPublicationAuditDetail publication):
                ValidatePublicationSource(
                    envelope,
                    publication.Binding,
                    publication.DependencyClaimId,
                    publication.DependencyClaimRevision);
                return;
            case (
                AuditSource.Configd,
                SecretPublicationAuditDetail publication):
                ValidatePublicationSource(
                    envelope,
                    publication.Binding,
                    publication.DependencyClaimId,
                    publication.DependencyClaimRevision);
                return;
            case (
                AuditSource.Configd,
                ProjectionMutationAuditDetail projection):
                ValidateTargetPartition(
                    envelope.Partition,
                    projection.Binding.Target);
                RequireAttribution(
                    envelope.Attribution,
                    AuditAttributionKind.Workload);
                return;
            case (
                AuditSource.Execd,
                PlacementMutationAuditDetail placement):
                ValidateExecutionSource(envelope, placement.Target);
                return;
            case (
                AuditSource.Execd,
                WorkloadMutationAuditDetail workload):
                ValidateExecutionSource(
                    envelope,
                    workload.PlacementTarget);
                return;
            case (AuditSource.Execd, RunMutationAuditDetail run):
                ValidateExecutionSource(
                    envelope,
                    run.PlacementTarget);
                return;
            default:
                throw new AuditPermissionException();
        }
    }

    private static void ValidateTenantSource(
        AuditEnvelope envelope,
        TenantMutationAuditDetail detail)
    {
        RequireTenantPartition(envelope.Partition);
        if (detail.Action == 2)
        {
            RequireAttribution(
                envelope.Attribution,
                AuditAttributionKind.Operator,
                AuditAttributionKind.Invocation);
            return;
        }

        RequireAttribution(
            envelope.Attribution,
            AuditAttributionKind.Operator);
    }

    private static void ValidatePublicationSource(
        AuditEnvelope envelope,
        ConsumerBinding binding,
        string? dependencyClaimId,
        long? dependencyClaimRevision)
    {
        ValidateTargetPartition(envelope.Partition, binding.Target);
        if (envelope.Attribution.Kind == AuditAttributionKind.Workload)
        {
            if (dependencyClaimId is null
                || dependencyClaimRevision is null
                || IsGlobal(binding.Target))
            {
                throw new AuditPermissionException();
            }

            return;
        }

        if (dependencyClaimId is not null
            || dependencyClaimRevision is not null)
        {
            throw new AuditPermissionException();
        }

        RequireOperatorForGlobal(
            envelope.Attribution,
            binding.Target);
    }

    private static void ValidateExecutionSource(
        AuditEnvelope envelope,
        PlacementAuditTarget target)
    {
        ValidateTargetPartition(envelope.Partition, target);
        RequireOperatorForGlobal(envelope.Attribution, target);
    }

    private static void RequireOperatorForGlobal(
        AuditAttribution attribution,
        PlacementAuditTarget target)
    {
        if (IsGlobal(target))
        {
            RequireAttribution(
                attribution,
                AuditAttributionKind.Operator);
            return;
        }

        RequireAttribution(
            attribution,
            AuditAttributionKind.Operator,
            AuditAttributionKind.Invocation);
    }

    private static void ValidateTargetPartition(
        AuditPartition partition,
        PlacementAuditTarget target)
    {
        if (target.Kind == PlacementTargetKind.Global)
        {
            RequireGlobalPartition(partition);
            return;
        }

        RequireTenantPartition(partition);
        if (!string.Equals(
                partition.TenantId?.Value,
                target.TenantId?.Value,
                StringComparison.Ordinal))
        {
            throw new AuditPermissionException();
        }
    }

    private static void RequireGlobalPartition(AuditPartition partition)
    {
        if (partition.Kind != AuditPartitionKind.Global)
        {
            throw new AuditPermissionException();
        }
    }

    private static void RequireTenantPartition(AuditPartition partition)
    {
        if (partition.Kind != AuditPartitionKind.Tenant)
        {
            throw new AuditPermissionException();
        }
    }

    private static void RequireAttribution(
        AuditAttribution attribution,
        params AuditAttributionKind[] admitted)
    {
        if (!admitted.Contains(attribution.Kind))
        {
            throw new AuditPermissionException();
        }
    }
}
