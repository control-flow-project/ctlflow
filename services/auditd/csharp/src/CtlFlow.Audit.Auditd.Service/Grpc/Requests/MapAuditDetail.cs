using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.V1;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<AuditDetail> MapAuditDetail(
        AuditEvent value,
        CancellationToken cancellation) =>
        value.DetailCase switch
        {
            AuditEvent.DetailOneofCase.TenantMutation =>
                await MapTenantMutation(
                    value.TenantMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.WorkspaceMutation =>
                await MapWorkspaceMutation(
                    value.WorkspaceMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentitySession =>
                await MapIdentitySession(
                    value.IdentitySession,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityMembership =>
                await MapIdentityMembership(
                    value.IdentityMembership,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityGroup =>
                await MapIdentityGroup(
                    value.IdentityGroup,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityGroupMember =>
                await MapIdentityGroupMember(
                    value.IdentityGroupMember,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityVirtualPrincipal =>
                await MapIdentityVirtualPrincipal(
                    value.IdentityVirtualPrincipal,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityExternalLink =>
                await MapIdentityExternalLink(
                    value.IdentityExternalLink,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityLoginProvider =>
                await MapIdentityLoginProvider(
                    value.IdentityLoginProvider,
                    cancellation),
            AuditEvent.DetailOneofCase.IdentityWorkspaceProviderAdmission =>
                await MapIdentityWorkspaceProviderAdmission(
                    value.IdentityWorkspaceProviderAdmission,
                    cancellation),
            AuditEvent.DetailOneofCase.PackageDeclaration =>
                await MapPackageDeclaration(
                    value.PackageDeclaration,
                    cancellation),
            AuditEvent.DetailOneofCase.AppMutation =>
                await MapAppMutation(
                    value.AppMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.ConfigurationPublication =>
                await MapConfigurationPublication(
                    value.ConfigurationPublication,
                    cancellation),
            AuditEvent.DetailOneofCase.SecretPublication =>
                await MapSecretPublication(
                    value.SecretPublication,
                    cancellation),
            AuditEvent.DetailOneofCase.ProjectionMutation =>
                await MapProjectionMutation(
                    value.ProjectionMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.PlacementMutation =>
                await MapPlacementMutation(
                    value.PlacementMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.WorkloadMutation =>
                await MapWorkloadMutation(
                    value.WorkloadMutation,
                    cancellation),
            AuditEvent.DetailOneofCase.RunMutation =>
                await MapRunMutation(
                    value.RunMutation,
                    cancellation),
            _ => throw new ArgumentException("Audit detail is required")
        };
}
