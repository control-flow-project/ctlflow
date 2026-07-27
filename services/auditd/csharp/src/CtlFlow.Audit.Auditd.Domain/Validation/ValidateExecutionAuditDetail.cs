using CtlFlow.Audit.Auditd.Domain.Details;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidatePlacementMutation(
        PlacementMutationAuditDetail detail)
    {
        ValidateCanonicalId(
            detail.PlacementId,
            64,
            nameof(detail.PlacementId));
        ValidatePlacementTarget(detail.Target);
        ValidateMutationRevision(
            detail.Action,
            detail.PlacementRevision,
            "Placement");
        ValidateDesiredState(detail.ResultingDesiredState);
    }

    private static void ValidateWorkloadMutation(
        WorkloadMutationAuditDetail detail)
    {
        ValidateCanonicalId(
            detail.WorkloadId,
            64,
            nameof(detail.WorkloadId));
        ValidateCanonicalId(
            detail.PlacementId,
            64,
            nameof(detail.PlacementId));
        ValidatePlacementTarget(detail.PlacementTarget);
        ValidateMutationRevision(
            detail.Action,
            detail.WorkloadRevision,
            "Workload");
        ValidateDesiredState(detail.ResultingDesiredState);
        ValidateCanonicalId(detail.AppId, 64, nameof(detail.AppId));
        ValidatePositive(detail.AppRevision, nameof(detail.AppRevision));
        ValidatePackageId(detail.PackageId, nameof(detail.PackageId));
        ValidatePositive(
            detail.PackageGeneration,
            nameof(detail.PackageGeneration));
        ValidateCanonicalId(
            detail.ComponentId,
            64,
            nameof(detail.ComponentId));
    }

    private static void ValidateRunMutation(RunMutationAuditDetail detail)
    {
        ValidatePackageId(detail.RunId, nameof(detail.RunId));
        ValidateCanonicalId(
            detail.WorkloadId,
            64,
            nameof(detail.WorkloadId));
        ValidateCanonicalId(
            detail.PlacementId,
            64,
            nameof(detail.PlacementId));
        ValidatePlacementTarget(detail.PlacementTarget);
        ValidateMutationRevision(
            detail.Action,
            detail.RunRevision,
            "Run");
        if (detail.ConfiguredActorPrincipalId is not null)
        {
            ValidatePrincipal(
                detail.ConfiguredActorPrincipalId,
                accountOnly: false);
        }
    }

    private static void ValidateDesiredState(int value)
    {
        if (value is < 1 or > 3)
        {
            throw new ArgumentException(
                "Execution desired state is invalid");
        }
    }
}
