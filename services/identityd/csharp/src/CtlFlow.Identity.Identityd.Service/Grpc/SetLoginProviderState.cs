using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using LoginProvidersDb =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CtlFlow.Identity.V1.LoginProvider>
        SetLoginProviderState(
            SetLoginProviderStateRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.SetLoginProviderState,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var revision = await Revision.Parse(
            request.ExpectedRevision,
            context.CancellationToken);
        var state = await ParseLoginProviderState(
            request.State,
            context.CancellationToken);
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.SetLoginProviderState,
            target,
            $"/tenants/{tenantId.Value}/login-providers/{providerId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await LoginProvidersDb.SetLoginProviderState(
            _identityDatabase,
            tenantId,
            providerId,
            revision,
            state,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return CreateLoginProviderMessage(result.Value);
    }
}
