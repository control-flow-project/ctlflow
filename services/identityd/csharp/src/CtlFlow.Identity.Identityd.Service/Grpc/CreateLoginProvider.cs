using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using LoginProvidersDb =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CtlFlow.Identity.V1.LoginProvider>
        CreateLoginProvider(
            CreateLoginProviderRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.CreateLoginProvider,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var displayName = await ProviderDisplayName.Parse(
            request.DisplayName,
            context.CancellationToken);
        var configurationId = await ConfigurationId.Parse(
            request.ConfigurationId,
            context.CancellationToken);
        var configurationVersionId = await ConfigurationVersionId.Parse(
            request.ConfigurationVersionId,
            context.CancellationToken);
        var secretId = await SecretId.Parse(
            request.SecretId,
            context.CancellationToken);
        var secretVersionId = await SecretVersionId.Parse(
            request.SecretVersionId,
            context.CancellationToken);
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.CreateLoginProvider,
            target,
            $"/tenants/{tenantId.Value}/login-providers/{providerId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await LoginProvidersDb.CreateLoginProvider(
            _identityDatabase,
            tenantId,
            providerId,
            displayName,
            configurationId,
            configurationVersionId,
            secretId,
            secretVersionId,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return CreateLoginProviderMessage(result.Value);
    }
}
