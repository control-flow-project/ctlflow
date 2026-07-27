using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using DomainTenantMutation =
    CtlFlow.Audit.Auditd.Domain.Details.TenantMutationAuditDetail;
using DomainWorkspaceMutation =
    CtlFlow.Audit.Auditd.Domain.Details.WorkspaceMutationAuditDetail;
using WireTenantMutation =
    CtlFlow.Audit.V1.TenantMutationAuditDetail;
using WireWorkspaceMutation =
    CtlFlow.Audit.V1.WorkspaceMutationAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainTenantMutation> MapTenantMutation(
        WireTenantMutation value,
        CancellationToken cancellation) =>
        new(
            MapTenantAction(value.Action),
            await ParseRevision(
                value.ResourceRevision,
                cancellation),
            MapTenancyState(value.ResultingState));

    private static async ValueTask<DomainWorkspaceMutation>
        MapWorkspaceMutation(
        WireWorkspaceMutation value,
        CancellationToken cancellation) =>
        new(
            await WorkspaceId.Parse(value.WorkspaceId, cancellation),
            MapWorkspaceAction(value.Action),
            await ParseRevision(
                value.ResourceRevision,
                cancellation),
            MapTenancyState(value.ResultingState));
}
