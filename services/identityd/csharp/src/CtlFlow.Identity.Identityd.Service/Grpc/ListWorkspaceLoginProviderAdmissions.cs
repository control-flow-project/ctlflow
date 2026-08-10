using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
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
    public override async Task<ListWorkspaceLoginProviderAdmissionsResponse>
        ListWorkspaceLoginProviderAdmissions(
            ListWorkspaceLoginProviderAdmissionsRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateProviderRead(
            context,
            _settings.ListWorkspaceLoginProviderAdmissionsAuthdCallers,
            IdentityAdminOperation.ListWorkspaceLoginProviderAdmissions,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.WorkspaceId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterProviderId
            ? await ProviderId.Parse(
                request.AfterProviderId,
                context.CancellationToken)
            : null;
        await AuthorizeProviderRead(
            identity,
            _settings.ListWorkspaceLoginProviderAdmissionsAuthdCallers,
            IdentityAdminOperation.ListWorkspaceLoginProviderAdmissions,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/login-providers",
            context);
        var page = await LoginProvidersDb
            .ListWorkspaceLoginProviderAdmissions(
                _identityDatabase,
                target.TenantId,
                target.WorkspaceId!,
                pageSize,
                after,
                context.CancellationToken);
        var response = new ListWorkspaceLoginProviderAdmissionsResponse();
        response.Admissions.AddRange(page.Items.Select(
            CreateWorkspaceLoginProviderAdmissionMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterProviderId = page.NextAfter;
        }

        return response;
    }
}
