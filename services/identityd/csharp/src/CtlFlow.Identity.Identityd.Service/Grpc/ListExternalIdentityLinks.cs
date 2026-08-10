using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityLinksDb =
    CtlFlow.Identity.Identityd.Db.IdentityLinks.IdentityLinks;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListExternalIdentityLinksResponse>
        ListExternalIdentityLinks(
            ListExternalIdentityLinksRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListExternalIdentityLinks,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterProviderSubject
            ? await ProviderSubject.Parse(
                request.AfterProviderSubject,
                context.CancellationToken)
            : null;
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListExternalIdentityLinks,
            target,
            $"/tenants/{tenantId.Value}/login-providers/{providerId.Value}/identity-links",
            context);
        var page = await IdentityLinksDb.ListExternalIdentityLinks(
            _identityDatabase,
            tenantId,
            providerId,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListExternalIdentityLinksResponse();
        response.Links.AddRange(
            page.Items.Select(CreateExternalIdentityLinkMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterProviderSubject = page.NextAfter;
        }

        return response;
    }
}
