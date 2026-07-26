using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using TenantDatabase = CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Tenant> CreateTenant(
        CreateTenantRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAdministration(context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await TenantDatabase.CreateTenant(
            _tenantDatabase,
            await TenantId.Parse(
                request.TenantId,
                context.CancellationToken),
            await ResourceAddress.Parse(
                request.Address,
                context.CancellationToken),
            await DisplayName.Parse(
                request.DisplayName,
                context.CancellationToken),
            audit,
            context.CancellationToken);
        return await CompleteTenantMutation(
            result,
            context.CancellationToken);
    }
}
