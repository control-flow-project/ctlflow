using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityMemberships =
    CtlFlow.Identity.Identityd.Db.Memberships.Memberships;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListTenantMembersResponse> ListTenantMembers(
        ListTenantMembersRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListTenantMembers,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterAccountId
            ? await AccountId.Parse(
                request.AfterAccountId,
                context.CancellationToken)
            : null;
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListTenantMembers,
            target,
            $"/tenants/{tenantId.Value}/members",
            context);
        var page = await IdentityMemberships.ListTenantMembers(
            _identityDatabase,
            tenantId,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListTenantMembersResponse();
        response.Members.AddRange(
            page.Items.Select(CreateTenantMemberMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterAccountId = page.NextAfter;
        }

        return response;
    }
}
