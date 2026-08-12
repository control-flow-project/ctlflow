using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using LoginProvidersDb =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CtlFlow.Identity.V1.WorkspaceLoginProviderAdmission>
        GetWorkspaceLoginProviderAdmission(
            GetWorkspaceLoginProviderAdmissionRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateProviderRead(
            context,
            _settings.GetWorkspaceLoginProviderAdmissionAuthdCallers,
            IdentityAdminOperation.GetWorkspaceLoginProviderAdmission,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.WorkspaceId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        await AuthorizeProviderRead(
            identity,
            _settings.GetWorkspaceLoginProviderAdmissionAuthdCallers,
            IdentityAdminOperation.GetWorkspaceLoginProviderAdmission,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/login-providers/{providerId.Value}",
            context);
        var admission = await LoginProvidersDb
            .GetWorkspaceLoginProviderAdmission(
                _identityDatabase,
                target.TenantId,
                target.WorkspaceId!,
                providerId,
                context.CancellationToken);
        return CreateWorkspaceLoginProviderAdmissionMessage(admission);
    }
}
