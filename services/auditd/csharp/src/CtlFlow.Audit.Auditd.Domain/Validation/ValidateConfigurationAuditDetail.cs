using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidateConfigurationPublication(
        ConfigurationPublicationAuditDetail detail)
    {
        ValidatePublication(
            detail.ConfigurationId,
            detail.ConfigurationVersionId,
            detail.Binding,
            detail.IdentityRevision,
            detail.DependencyClaimId,
            detail.DependencyClaimRevision);
    }

    private static void ValidateSecretPublication(
        SecretPublicationAuditDetail detail)
    {
        ValidatePublication(
            detail.SecretId,
            detail.SecretVersionId,
            detail.Binding,
            detail.IdentityRevision,
            detail.DependencyClaimId,
            detail.DependencyClaimRevision);
    }

    private static void ValidateProjectionMutation(
        ProjectionMutationAuditDetail detail)
    {
        ValidateProjectionId(detail.ProjectionId);
        ValidateMutationRevision(
            detail.Action,
            detail.ProjectionRevision,
            "Projection");
        switch (detail.TargetKind)
        {
            case ProjectionTargetKind.Configuration
                when detail.ConfigurationId is not null
                    && detail.ConfigurationVersionId is not null
                    && detail.SecretId is null
                    && detail.SecretVersionId is null:
                ValidateCanonicalId(
                    detail.ConfigurationId,
                    64,
                    nameof(detail.ConfigurationId));
                ValidateCanonicalId(
                    detail.ConfigurationVersionId,
                    64,
                    nameof(detail.ConfigurationVersionId));
                break;
            case ProjectionTargetKind.Secret
                when detail.ConfigurationId is null
                    && detail.ConfigurationVersionId is null
                    && detail.SecretId is not null
                    && detail.SecretVersionId is not null:
                ValidateCanonicalId(
                    detail.SecretId,
                    64,
                    nameof(detail.SecretId));
                ValidateCanonicalId(
                    detail.SecretVersionId,
                    64,
                    nameof(detail.SecretVersionId));
                break;
            default:
                throw new ArgumentException(
                    "Projection target is invalid");
        }

        ValidateConsumerBinding(detail.Binding);
    }

    private static void ValidatePublication(
        string id,
        string versionId,
        ConsumerBinding binding,
        long identityRevision,
        string? dependencyClaimId,
        long? dependencyClaimRevision)
    {
        ValidateCanonicalId(id, 64, nameof(id));
        ValidateCanonicalId(versionId, 64, nameof(versionId));
        ValidateConsumerBinding(binding);
        ValidatePositive(identityRevision, nameof(identityRevision));
        if (dependencyClaimId is null
            && dependencyClaimRevision is null)
        {
            return;
        }

        if (dependencyClaimId is null
            || dependencyClaimRevision is null)
        {
            throw new ArgumentException(
                "Dependency claim identity is incomplete");
        }

        ValidateDependencyClaimId(dependencyClaimId);
        ValidatePositive(
            dependencyClaimRevision.Value,
            nameof(dependencyClaimRevision));
    }

    private static void ValidateMutationRevision(
        int action,
        long revision,
        string kind)
    {
        if (action == 1 && revision == 1
            || action == 2 && revision >= 2)
        {
            return;
        }

        throw new ArgumentException($"{kind} mutation is invalid");
    }
}
