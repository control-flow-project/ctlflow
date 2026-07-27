using CtlFlow.Audit.Auditd.Domain.Apps;
using CtlFlow.Audit.Auditd.Domain.Packages;
using CtlFlow.Audit.Auditd.Domain.Placements;
using DomainAppMutation =
    CtlFlow.Audit.Auditd.Domain.Details.AppMutationAuditDetail;
using DomainPackageDeclaration =
    CtlFlow.Audit.Auditd.Domain.Details.PackageDeclarationAuditDetail;
using WireAppMutation =
    CtlFlow.Audit.V1.AppMutationAuditDetail;
using WirePackageDeclaration =
    CtlFlow.Audit.V1.PackageDeclarationAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainPackageDeclaration>
        MapPackageDeclaration(
        WirePackageDeclaration value,
        CancellationToken cancellation) =>
        new(
            await PackageId.Parse(value.PackageId, cancellation),
            await ParseGeneration(value.Generation, cancellation));

    private static async ValueTask<DomainAppMutation> MapAppMutation(
        WireAppMutation value,
        CancellationToken cancellation) =>
        new(
            await AppId.Parse(value.AppId, cancellation),
            await MapPlacementTarget(value.Scope, cancellation),
            await PlacementId.Parse(value.PlacementId, cancellation),
            await PackageId.Parse(value.PackageId, cancellation),
            await ParseGeneration(
                value.PackageGeneration,
                cancellation),
            await ParseRevision(value.AppRevision, cancellation),
            MapAppAction(value.Action));
}
