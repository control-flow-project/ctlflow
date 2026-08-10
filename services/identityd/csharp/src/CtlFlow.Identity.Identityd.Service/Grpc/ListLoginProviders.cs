using CtlFlow.Identity.Identityd.Domain.Collections;
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
    public override async Task<ListLoginProvidersResponse> ListLoginProviders(
        ListLoginProvidersRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListLoginProviders,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterProviderId
            ? await ProviderId.Parse(
                request.AfterProviderId,
                context.CancellationToken)
            : null;
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListLoginProviders,
            target,
            $"/tenants/{tenantId.Value}/login-providers",
            context);
        var page = await LoginProvidersDb.ListLoginProviders(
            _identityDatabase,
            tenantId,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListLoginProvidersResponse();
        response.Providers.AddRange(
            page.Items.Select(CreateLoginProviderMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterProviderId = page.NextAfter;
        }

        return response;
    }
}
