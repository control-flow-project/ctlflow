using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Packages;
using CtlFlow.Audit.Auditd.Domain.Resources;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class PackageDeclarationAuditDetail : AuditDetail
{
    private PackageDeclarationAuditDetail()
    {
        PackageId = null!;
    }

    public PackageDeclarationAuditDetail(
        PackageId packageId,
        Generation generation)
        : base(AuditDetailKind.PackageDeclaration)
    {
        PackageId = packageId.Value;
        Generation = generation.Value;
    }

    internal string PackageId { get; private set; }

    internal long Generation { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(PackageId);
        writer.Append(Generation);
    }
}
