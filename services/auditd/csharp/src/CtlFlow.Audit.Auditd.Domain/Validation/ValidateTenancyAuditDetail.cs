using CtlFlow.Audit.Auditd.Domain.Details;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidateTenantMutation(
        TenantMutationAuditDetail detail)
    {
        ValidateTenancyMutation(
            detail.Action,
            detail.ResourceRevision,
            detail.ResultingState);
    }

    private static void ValidateWorkspaceMutation(
        WorkspaceMutationAuditDetail detail)
    {
        ValidateCanonicalId(
            detail.WorkspaceId,
            64,
            nameof(detail.WorkspaceId));
        ValidateTenancyMutation(
            detail.Action,
            detail.ResourceRevision,
            detail.ResultingState);
    }

    private static void ValidateTenancyMutation(
        int action,
        long revision,
        int resultingState)
    {
        if (resultingState is < 1 or > 3
            || action is < 1 or > 3
            || action == 1 && (revision != 1 || resultingState != 1)
            || action is 2 or 3 && revision < 2)
        {
            throw new ArgumentException(
                "Tenancy mutation detail is invalid");
        }
    }
}
