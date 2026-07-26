using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
using TenantDatabase = CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Tenant> UpdateTenant(
        UpdateTenantRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateTenantUpdate(context);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var expectedRevision = await Revision.Parse(
            request.ExpectedRevision,
            context.CancellationToken);
        var displayName = await DisplayName.Parse(
            request.DisplayName,
            context.CancellationToken);
        await AuthorizeTenantCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            TenantCapability.UpdateTenantDisplayName,
            tenantId,
            null,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await TenantDatabase.UpdateTenant(
            _tenantDatabase,
            tenantId,
            expectedRevision,
            displayName,
            audit,
            context.CancellationToken);
        return await CompleteTenantMutation(
            result,
            context.CancellationToken);
    }
}
