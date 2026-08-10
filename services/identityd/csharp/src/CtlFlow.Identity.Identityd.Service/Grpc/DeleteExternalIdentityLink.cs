using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using IdentityLinksDb =
    CtlFlow.Identity.Identityd.Db.IdentityLinks.IdentityLinks;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<DeleteExternalIdentityLinkResponse>
        DeleteExternalIdentityLink(
            DeleteExternalIdentityLinkRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.DeleteExternalIdentityLink,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var providerSubject = await ProviderSubject.Parse(
            request.ProviderSubject,
            context.CancellationToken);
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.DeleteExternalIdentityLink,
            target,
            $"/tenants/{tenantId.Value}/login-providers/{providerId.Value}/identity-links",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityLinksDb.DeleteExternalIdentityLink(
            _identityDatabase,
            tenantId,
            providerId,
            providerSubject,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return new DeleteExternalIdentityLinkResponse();
    }
}
