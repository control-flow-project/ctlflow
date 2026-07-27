using CtlFlow.Audit.Auditd.Domain.Details;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidateIdentitySession(
        IdentitySessionAuditDetail detail)
    {
        ValidateSessionId(detail.SessionId);
        ValidatePrincipal(
            detail.HumanAccountPrincipalId,
            accountOnly: true,
            humanOnly: true);
        if (detail.Action == 1 && detail.SessionRevision == 1
            || detail.Action == 2 && detail.SessionRevision == 2)
        {
            return;
        }

        throw new ArgumentException(
            "Identity Session audit detail is invalid");
    }
}
