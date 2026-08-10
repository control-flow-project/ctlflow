using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using LoginProvidersDb =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CtlFlow.Identity.V1.LoginProvider>
        GetLoginProvider(
            GetLoginProviderRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateProviderRead(
            context,
            _settings.GetLoginProviderAuthdCallers,
            IdentityAdminOperation.GetLoginProvider,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeProviderRead(
            identity,
            _settings.GetLoginProviderAuthdCallers,
            IdentityAdminOperation.GetLoginProvider,
            target,
            $"/tenants/{tenantId.Value}/login-providers/{providerId.Value}",
            context);
        var provider = await LoginProvidersDb.GetLoginProvider(
            _identityDatabase,
            tenantId,
            providerId,
            context.CancellationToken);
        return CreateLoginProviderMessage(provider);
    }
}
