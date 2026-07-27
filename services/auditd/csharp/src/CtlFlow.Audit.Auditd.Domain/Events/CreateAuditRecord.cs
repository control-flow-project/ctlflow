using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Events;

public static partial class AuditRecords
{
    public static ValueTask<AuditRecord> CreateAuditRecord(
        AuditEnvelope envelope,
        AuditDetail detail,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(detail);
        ValidateAuditEnvelope(envelope);
        ValidateAuditDetail(detail);
        ValidateSourceAdmission(envelope, detail);
        return ValueTask.FromResult(new AuditRecord(envelope, detail));
    }
}
