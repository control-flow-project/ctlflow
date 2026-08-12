using CtlFlow.Identity.Identityd.Domain.Providers;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.WorkspaceLoginProviderAdmission
        CreateWorkspaceLoginProviderAdmissionMessage(
            WorkspaceLoginProviderAdmission admission) => new()
        {
            TenantId = admission.TenantId.Value,
            WorkspaceId = admission.WorkspaceId.Value,
            ProviderId = admission.ProviderId.Value
        };
}
