using CtlFlow.Audit.Auditd.Domain.Apps;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Packages;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class AppMutationAuditDetail : AuditDetail
{
    private AppMutationAuditDetail()
    {
        AppId = null!;
        PlacementId = null!;
        PackageId = null!;
    }

    public AppMutationAuditDetail(
        AppId appId,
        PlacementAuditTarget scope,
        PlacementId placementId,
        PackageId packageId,
        Generation packageGeneration,
        Revision appRevision,
        AppAuditAction action)
        : base(AuditDetailKind.AppMutation)
    {
        AppId = appId.Value;
        ScopeKind = scope.Kind;
        ScopeTenantId = scope.TenantId?.Value;
        ScopeWorkspaceId = scope.WorkspaceId?.Value;
        ScopeAccountPrincipalId = scope.AccountPrincipalId?.Value;
        PlacementId = placementId.Value;
        PackageId = packageId.Value;
        PackageGeneration = packageGeneration.Value;
        AppRevision = appRevision.Value;
        Action = (int)action;
    }

    internal string AppId { get; private set; }
    internal PlacementTargetKind ScopeKind { get; private set; }
    internal string? ScopeTenantId { get; private set; }
    internal string? ScopeWorkspaceId { get; private set; }
    internal string? ScopeAccountPrincipalId { get; private set; }
    internal string PlacementId { get; private set; }
    internal string PackageId { get; private set; }
    internal long PackageGeneration { get; private set; }
    internal long AppRevision { get; private set; }
    internal int Action { get; private set; }

    internal PlacementAuditTarget Scope => new(
        ScopeKind,
        ScopeTenantId is null
            ? null
            : TenantId.FromStorage(ScopeTenantId),
        ScopeWorkspaceId is null
            ? null
            : WorkspaceId.FromStorage(ScopeWorkspaceId),
        ScopeAccountPrincipalId is null
            ? null
            : AccountId.FromStorage(ScopeAccountPrincipalId));

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(AppId);
        WriteTarget(writer, Scope);
        writer.Append(PlacementId);
        writer.Append(PackageId);
        writer.Append(PackageGeneration);
        writer.Append(AppRevision);
        writer.Append(Action);
    }
}
