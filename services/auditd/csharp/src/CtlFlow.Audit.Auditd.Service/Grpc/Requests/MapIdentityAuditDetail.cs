using CtlFlow.Audit.Auditd.Domain.Groups;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Providers;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Sessions;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using DomainIdentityExternalLink =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityExternalLinkAuditDetail;
using DomainIdentityGroup =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityGroupAuditDetail;
using DomainIdentityGroupMember =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityGroupMemberAuditDetail;
using DomainIdentityLoginProvider =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityLoginProviderAuditDetail;
using DomainIdentityMembership =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityMembershipAuditDetail;
using DomainIdentitySession =
    CtlFlow.Audit.Auditd.Domain.Details.IdentitySessionAuditDetail;
using DomainIdentityVirtualPrincipal =
    CtlFlow.Audit.Auditd.Domain.Details.IdentityVirtualPrincipalAuditDetail;
using DomainIdentityWorkspaceProviderAdmission =
    CtlFlow.Audit.Auditd.Domain.Details
        .IdentityWorkspaceProviderAdmissionAuditDetail;
using WireIdentityExternalLink =
    CtlFlow.Audit.V1.IdentityExternalLinkAuditDetail;
using WireIdentityGroup =
    CtlFlow.Audit.V1.IdentityGroupAuditDetail;
using WireIdentityGroupMember =
    CtlFlow.Audit.V1.IdentityGroupMemberAuditDetail;
using WireIdentityLoginProvider =
    CtlFlow.Audit.V1.IdentityLoginProviderAuditDetail;
using WireIdentityMembership =
    CtlFlow.Audit.V1.IdentityMembershipAuditDetail;
using WireIdentitySession =
    CtlFlow.Audit.V1.IdentitySessionAuditDetail;
using WireIdentityVirtualPrincipal =
    CtlFlow.Audit.V1.IdentityVirtualPrincipalAuditDetail;
using WireIdentityWorkspaceProviderAdmission =
    CtlFlow.Audit.V1.IdentityWorkspaceProviderAdmissionAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainIdentitySession> MapIdentitySession(
        WireIdentitySession value,
        CancellationToken cancellation) =>
        new(
            await SessionId.Parse(value.SessionId, cancellation),
            await HumanAccountId.Parse(
                value.HumanAccountPrincipalId,
                cancellation),
            await ParseRevision(value.SessionRevision, cancellation),
            MapSessionAction(value.Action));

    private static async ValueTask<DomainIdentityMembership>
        MapIdentityMembership(
            WireIdentityMembership value,
            CancellationToken cancellation) =>
        new(
            await AccountId.Parse(value.AccountPrincipalId, cancellation),
            await ParseOptionalWorkspace(
                value.HasWorkspaceId,
                value.WorkspaceId,
                cancellation),
            await ParseRevision(value.MembershipRevision, cancellation),
            MapMembershipAction(value.Action),
            value.AccountCreated);

    private static async ValueTask<DomainIdentityGroup> MapIdentityGroup(
        WireIdentityGroup value,
        CancellationToken cancellation) =>
        new(
            await GroupId.Parse(value.GroupId, cancellation),
            await ParseOptionalWorkspace(
                value.HasWorkspaceId,
                value.WorkspaceId,
                cancellation),
            MapGroupAction(value.Action));

    private static async ValueTask<DomainIdentityGroupMember>
        MapIdentityGroupMember(
            WireIdentityGroupMember value,
            CancellationToken cancellation) =>
        new(
            await GroupId.Parse(value.GroupId, cancellation),
            await PrincipalId.Parse(value.PrincipalId, cancellation),
            await ParseOptionalWorkspace(
                value.HasWorkspaceId,
                value.WorkspaceId,
                cancellation),
            MapGroupMemberAction(value.Action));

    private static async ValueTask<DomainIdentityVirtualPrincipal>
        MapIdentityVirtualPrincipal(
            WireIdentityVirtualPrincipal value,
            CancellationToken cancellation) =>
        new(
            await VirtualPrincipalId.Parse(
                value.PrincipalId,
                cancellation),
            await AccountId.Parse(
                value.AttachedAccountPrincipalId,
                cancellation),
            await ParseOptionalWorkspace(
                value.HasWorkspaceId,
                value.WorkspaceId,
                cancellation),
            await ParseRevision(value.PrincipalRevision, cancellation),
            value.Enabled,
            MapVirtualPrincipalAction(value.Action));

    private static async ValueTask<DomainIdentityExternalLink>
        MapIdentityExternalLink(
            WireIdentityExternalLink value,
            CancellationToken cancellation) =>
        new(
            await ProviderId.Parse(value.ProviderId, cancellation),
            await HumanAccountId.Parse(
                value.HumanAccountPrincipalId,
                cancellation),
            MapExternalLinkAction(value.Action));

    private static async ValueTask<DomainIdentityLoginProvider>
        MapIdentityLoginProvider(
            WireIdentityLoginProvider value,
            CancellationToken cancellation) =>
        new(
            await ProviderId.Parse(value.ProviderId, cancellation),
            await ParseRevision(value.ProviderRevision, cancellation),
            MapLoginProviderState(value.ResultingState),
            MapLoginProviderAction(value.Action));

    private static async ValueTask<
        DomainIdentityWorkspaceProviderAdmission>
        MapIdentityWorkspaceProviderAdmission(
            WireIdentityWorkspaceProviderAdmission value,
            CancellationToken cancellation) =>
        new(
            await WorkspaceId.Parse(value.WorkspaceId, cancellation),
            await ProviderId.Parse(value.ProviderId, cancellation),
            MapWorkspaceProviderAdmissionAction(value.Action));

    private static async ValueTask<WorkspaceId?> ParseOptionalWorkspace(
        bool hasValue,
        string value,
        CancellationToken cancellation) =>
        hasValue
            ? await WorkspaceId.Parse(value, cancellation)
            : null;
}
