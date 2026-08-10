using CtlFlow.Audit.Auditd.Domain.Events;
using AppAction = CtlFlow.Audit.V1.AppMutationAction;
using DesiredState = CtlFlow.Audit.V1.ExecutionDesiredState;
using ProjectionAction = CtlFlow.Audit.V1.ProjectionMutationAction;
using RunAction = CtlFlow.Audit.V1.RunMutationAction;
using SessionAction = CtlFlow.Audit.V1.IdentitySessionAction;
using MembershipAction = CtlFlow.Audit.V1.IdentityMembershipAction;
using GroupAction = CtlFlow.Audit.V1.IdentityGroupAction;
using GroupMemberAction = CtlFlow.Audit.V1.IdentityGroupMemberAction;
using VirtualPrincipalAction =
    CtlFlow.Audit.V1.IdentityVirtualPrincipalAction;
using ExternalLinkAction = CtlFlow.Audit.V1.IdentityExternalLinkAction;
using LoginProviderAction = CtlFlow.Audit.V1.IdentityLoginProviderAction;
using LoginProviderState = CtlFlow.Audit.V1.IdentityLoginProviderState;
using WorkspaceProviderAdmissionAction =
    CtlFlow.Audit.V1.IdentityWorkspaceProviderAdmissionAction;
using TenantAction = CtlFlow.Audit.V1.TenantMutationAction;
using TenancyState = CtlFlow.Audit.V1.TenancyResourceState;
using PlacementAction = CtlFlow.Audit.V1.PlacementMutationAction;
using WorkloadAction = CtlFlow.Audit.V1.WorkloadMutationAction;
using WorkspaceAction = CtlFlow.Audit.V1.WorkspaceMutationAction;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static TenantAuditAction MapTenantAction(TenantAction value) =>
        value switch
        {
            TenantAction.CreateTenant => TenantAuditAction.Create,
            TenantAction.UpdateTenant => TenantAuditAction.Update,
            TenantAction.SetTenantState => TenantAuditAction.SetState,
            _ => throw new ArgumentException(
                "Tenant mutation action is invalid")
        };

    private static WorkspaceAuditAction MapWorkspaceAction(
        WorkspaceAction value) =>
        value switch
        {
            WorkspaceAction.CreateWorkspace => WorkspaceAuditAction.Create,
            WorkspaceAction.UpdateWorkspace => WorkspaceAuditAction.Update,
            WorkspaceAction.SetWorkspaceState =>
                WorkspaceAuditAction.SetState,
            _ => throw new ArgumentException(
                "Workspace mutation action is invalid")
        };

    private static TenancyAuditState MapTenancyState(TenancyState value) =>
        value switch
        {
            TenancyState.Active => TenancyAuditState.Active,
            TenancyState.Suspended => TenancyAuditState.Suspended,
            TenancyState.Deleted => TenancyAuditState.Deleted,
            _ => throw new ArgumentException(
                "Tenancy resource state is invalid")
        };

    private static IdentitySessionAuditAction MapSessionAction(
        SessionAction value) =>
        value switch
        {
            SessionAction.Created => IdentitySessionAuditAction.Created,
            SessionAction.Revoked => IdentitySessionAuditAction.Revoked,
            _ => throw new ArgumentException(
                "Identity Session action is invalid")
        };

    private static IdentityMembershipAuditAction MapMembershipAction(
        MembershipAction value) =>
        value switch
        {
            MembershipAction.Added => IdentityMembershipAuditAction.Added,
            MembershipAction.Removed =>
                IdentityMembershipAuditAction.Removed,
            _ => throw new ArgumentException(
                "Identity Membership action is invalid")
        };

    private static IdentityGroupAuditAction MapGroupAction(
        GroupAction value) =>
        value switch
        {
            GroupAction.Created => IdentityGroupAuditAction.Created,
            GroupAction.Deleted => IdentityGroupAuditAction.Deleted,
            _ => throw new ArgumentException(
                "Identity Group action is invalid")
        };

    private static IdentityGroupMemberAuditAction MapGroupMemberAction(
        GroupMemberAction value) =>
        value switch
        {
            GroupMemberAction.Added =>
                IdentityGroupMemberAuditAction.Added,
            GroupMemberAction.Removed =>
                IdentityGroupMemberAuditAction.Removed,
            _ => throw new ArgumentException(
                "Identity Group member action is invalid")
        };

    private static IdentityVirtualPrincipalAuditAction
        MapVirtualPrincipalAction(VirtualPrincipalAction value) =>
        value switch
        {
            VirtualPrincipalAction.Created =>
                IdentityVirtualPrincipalAuditAction.Created,
            VirtualPrincipalAction.EnabledStateChanged =>
                IdentityVirtualPrincipalAuditAction.EnabledStateChanged,
            _ => throw new ArgumentException(
                "Identity virtual-principal action is invalid")
        };

    private static IdentityExternalLinkAuditAction MapExternalLinkAction(
        ExternalLinkAction value) =>
        value switch
        {
            ExternalLinkAction.Created =>
                IdentityExternalLinkAuditAction.Created,
            ExternalLinkAction.Deleted =>
                IdentityExternalLinkAuditAction.Deleted,
            _ => throw new ArgumentException(
                "Identity external-link action is invalid")
        };

    private static IdentityLoginProviderAuditAction MapLoginProviderAction(
        LoginProviderAction value) =>
        value switch
        {
            LoginProviderAction.Created =>
                IdentityLoginProviderAuditAction.Created,
            LoginProviderAction.Updated =>
                IdentityLoginProviderAuditAction.Updated,
            LoginProviderAction.StateChanged =>
                IdentityLoginProviderAuditAction.StateChanged,
            _ => throw new ArgumentException(
                "Identity login-provider action is invalid")
        };

    private static IdentityLoginProviderAuditState MapLoginProviderState(
        LoginProviderState value) =>
        value switch
        {
            LoginProviderState.Active =>
                IdentityLoginProviderAuditState.Active,
            LoginProviderState.Disabled =>
                IdentityLoginProviderAuditState.Disabled,
            LoginProviderState.Deleted =>
                IdentityLoginProviderAuditState.Deleted,
            _ => throw new ArgumentException(
                "Identity login-provider state is invalid")
        };

    private static IdentityWorkspaceProviderAdmissionAuditAction
        MapWorkspaceProviderAdmissionAction(
            WorkspaceProviderAdmissionAction value) =>
        value switch
        {
            WorkspaceProviderAdmissionAction.Admitted =>
                IdentityWorkspaceProviderAdmissionAuditAction.Admitted,
            WorkspaceProviderAdmissionAction.Removed =>
                IdentityWorkspaceProviderAdmissionAuditAction.Removed,
            _ => throw new ArgumentException(
                "Identity Workspace provider admission action is invalid")
        };

    private static AppAuditAction MapAppAction(AppAction value) =>
        value switch
        {
            AppAction.Created => AppAuditAction.Created,
            AppAction.PackageGenerationChanged =>
                AppAuditAction.PackageGenerationChanged,
            _ => throw new ArgumentException(
                "App mutation action is invalid")
        };

    private static ProjectionAuditAction MapProjectionAction(
        ProjectionAction value) =>
        value switch
        {
            ProjectionAction.Created => ProjectionAuditAction.Created,
            ProjectionAction.VersionChanged =>
                ProjectionAuditAction.VersionChanged,
            _ => throw new ArgumentException(
                "Projection mutation action is invalid")
        };

    private static PlacementAuditAction MapPlacementAction(
        PlacementAction value) =>
        value switch
        {
            PlacementAction.Declared => PlacementAuditAction.Declared,
            PlacementAction.Updated => PlacementAuditAction.Updated,
            _ => throw new ArgumentException(
                "Placement mutation action is invalid")
        };

    private static WorkloadAuditAction MapWorkloadAction(
        WorkloadAction value) =>
        value switch
        {
            WorkloadAction.Declared => WorkloadAuditAction.Declared,
            WorkloadAction.Updated => WorkloadAuditAction.Updated,
            _ => throw new ArgumentException(
                "Workload mutation action is invalid")
        };

    private static RunAuditAction MapRunAction(RunAction value) =>
        value switch
        {
            RunAction.Created => RunAuditAction.Created,
            RunAction.CancellationRequested =>
                RunAuditAction.CancellationRequested,
            _ => throw new ArgumentException(
                "Run mutation action is invalid")
        };

    private static ExecutionAuditState MapDesiredState(DesiredState value) =>
        value switch
        {
            DesiredState.Active => ExecutionAuditState.Active,
            DesiredState.Suspended => ExecutionAuditState.Suspended,
            DesiredState.Retired => ExecutionAuditState.Retired,
            _ => throw new ArgumentException(
                "Execution desired state is invalid")
        };
}
