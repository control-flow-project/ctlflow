using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal sealed class AuditDispatcher(
    IDbContextFactory<TenantDbContext> databaseContexts,
    AuditService.AuditServiceClient client,
    AuditSettings settings,
    TenantdTelemetry telemetry) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        DispatchAuditOutbox(
            databaseContexts,
            client,
            settings,
            telemetry,
            stoppingToken);
}
