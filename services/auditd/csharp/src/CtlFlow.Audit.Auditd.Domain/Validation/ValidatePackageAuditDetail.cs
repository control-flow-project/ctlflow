using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidatePackageDeclaration(
        PackageDeclarationAuditDetail detail)
    {
        ValidatePackageId(detail.PackageId, nameof(detail.PackageId));
        ValidatePositive(detail.Generation, nameof(detail.Generation));
    }

    private static void ValidateAppMutation(AppMutationAuditDetail detail)
    {
        ValidateCanonicalId(detail.AppId, 64, nameof(detail.AppId));
        ValidatePlacementTarget(detail.Scope);
        ValidateCanonicalId(
            detail.PlacementId,
            64,
            nameof(detail.PlacementId));
        ValidatePackageId(detail.PackageId, nameof(detail.PackageId));
        ValidatePositive(
            detail.PackageGeneration,
            nameof(detail.PackageGeneration));
        if (detail.Action == 1 && detail.AppRevision == 1
            || detail.Action == 2 && detail.AppRevision >= 2)
        {
            return;
        }

        throw new ArgumentException("App mutation detail is invalid");
    }
}
