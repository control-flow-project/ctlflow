using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using IdentityMemberships =
    CtlFlow.Identity.Identityd.Db.Memberships.Memberships;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<RemoveTenantMemberResponse>
        RemoveTenantMember(
            RemoveTenantMemberRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.RemoveTenantMember,
            now);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var accountId = await AccountId.Parse(
            request.AccountId,
            context.CancellationToken);
        var target = new IdentityTarget(tenantId, null);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.RemoveTenantMember,
            target,
            $"/tenants/{tenantId.Value}/members/{accountId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityMemberships.RemoveTenantMember(
            _identityDatabase,
            accountId,
            tenantId,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return new RemoveTenantMemberResponse();
    }
}
