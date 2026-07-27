using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using DomainTarget =
    CtlFlow.Audit.Auditd.Domain.Events.PlacementAuditTarget;
using DomainTargetKind =
    CtlFlow.Audit.Auditd.Domain.Events.PlacementTargetKind;
using WireTarget = CtlFlow.Audit.V1.PlacementAuditTarget;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainTarget> MapPlacementTarget(
        WireTarget? value,
        CancellationToken cancellation)
    {
        if (value is null)
        {
            throw new ArgumentException("Placement target is required");
        }

        return value.TargetCase switch
        {
            WireTarget.TargetOneofCase.Global => new DomainTarget(
                DomainTargetKind.Global,
                null,
                null,
                null),
            WireTarget.TargetOneofCase.Tenant => new DomainTarget(
                DomainTargetKind.Tenant,
                await TenantId.Parse(
                    value.Tenant.TenantId,
                    cancellation),
                null,
                null),
            WireTarget.TargetOneofCase.Workspace => new DomainTarget(
                DomainTargetKind.Workspace,
                await TenantId.Parse(
                    value.Workspace.TenantId,
                    cancellation),
                await WorkspaceId.Parse(
                    value.Workspace.WorkspaceId,
                    cancellation),
                null),
            WireTarget.TargetOneofCase.User => new DomainTarget(
                DomainTargetKind.User,
                await TenantId.Parse(
                    value.User.TenantId,
                    cancellation),
                null,
                await AccountId.Parse(
                    value.User.AccountPrincipalId,
                    cancellation)),
            _ => throw new ArgumentException(
                "Placement target is required")
        };
    }
}
