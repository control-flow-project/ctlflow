using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using CtlFlow.Tenancy.V1;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService(
    IDbContextFactory<TenantDbContext> databaseContexts,
    TenantOperationSettings settings,
    TokenAuthorities tokenAuthorities,
    TenantdTelemetry telemetry)
    : TenantService.TenantServiceBase
{
    private readonly IDbContextFactory<TenantDbContext> _databaseContexts =
        databaseContexts;
    private readonly TenantOperationSettings _settings = settings;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;
    private readonly TenantdTelemetry _telemetry = telemetry;
}
