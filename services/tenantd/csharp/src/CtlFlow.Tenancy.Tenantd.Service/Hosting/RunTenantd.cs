using System.Data.Common;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Grpc;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Db.Sqlite.TenantDatabases;
using static CtlFlow.Tenancy.Tenantd.Service.Configuration.TenantdConfiguration;
using static CtlFlow.Tenancy.Tenantd.Service.Telemetry.TelemetryConfiguration;

namespace CtlFlow.Tenancy.Tenantd.Service.Hosting;

internal static partial class TenantdProcess
{
    internal static async Task<int> RunTenantd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        SQLitePCL.Batteries_V2.Init();

        var databaseContexts = await CreateTenantDbContextFactory(
            settings.DatabasePath,
            settings.DatabasePoolSize,
            CancellationToken.None);
        var tokenAuthorities = new TokenAuthorities(
            settings.WorkloadTokens,
            settings.InvocationTokens);

        var builder = WebApplication.CreateSlimBuilder(args);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(
                settings.GrpcAddress,
                settings.GrpcPort,
                listen => listen.Protocols = HttpProtocols.Http2);
            options.Listen(
                settings.ProbeAddress,
                settings.ProbePort,
                listen => listen.Protocols = HttpProtocols.Http1);
        });

        ConfigureTelemetry(builder, settings.Telemetry);
        builder.Services.AddGrpc(options =>
        {
            options.EnableDetailedErrors = false;
            options.MaxReceiveMessageSize = 64 * 1024;
            options.MaxSendMessageSize = 64 * 1024;
        });
        builder.Services.AddSingleton(
            new TenantOperationSettings(
                settings.CacheLifetime,
                settings.ResolveTenantCallers,
                settings.ResolveWorkspaceCallers));
        builder.Services.AddSingleton<IDbContextFactory<TenantDbContext>>(
            databaseContexts);
        builder.Services.AddSingleton(tokenAuthorities);

        await using var application = builder.Build();
        application.Use(async (context, next) =>
        {
            var isProbe = context.Connection.LocalPort == settings.ProbePort;
            var requestPath = context.Request.Path.Value;
            var isProbePath = requestPath is "/healthz" or "/readyz";
            if (isProbe != isProbePath)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            await next(context);
        });
        application.MapGrpcService<TenantGrpcService>();
        application.MapGet(
            "/healthz",
            static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                IDbContextFactory<TenantDbContext> contexts,
                CancellationToken cancellation) =>
            {
                try
                {
                    return await VerifySchema(contexts, cancellation)
                        == SchemaCompatibility.Compatible
                        ? Results.NoContent()
                        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
                }
                catch (Exception exception) when (
                    exception is DbException
                        or InvalidOperationException)
                {
                    return Results.StatusCode(
                        StatusCodes.Status503ServiceUnavailable);
                }
            });

        await application.RunAsync();
        return 0;
    }
}
