using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Service.Auditing;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Grpc;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.EntityFrameworkCore;
using Grpc.Net.Client;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Db.Sqlite.TenantDatabases;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.AggregationHosting;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security.AggregationAuthentication;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;
using static CtlFlow.Tenancy.Tenantd.Service.Configuration.TenantdConfiguration;
using static CtlFlow.Tenancy.Tenantd.Service.Telemetry.TelemetryConfiguration;

namespace CtlFlow.Tenancy.Tenantd.Service.Hosting;

internal static partial class TenantdProcess
{
    internal static async Task<int> RunTenantd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        using var aggregationCertificates =
            await LoadAggregationCertificates(
                settings.Aggregation,
                CancellationToken.None);
        SQLitePCL.Batteries_V2.Init();

        var databaseContexts = await CreateTenantDbContextFactory(
            settings.DatabasePath,
            settings.DatabasePoolSize,
            CancellationToken.None);
        var tokenAuthorities = new TokenAuthorities(
            settings.WorkloadTokens,
            settings.InvocationTokens);
        var auditChannel = GrpcChannel.ForAddress(
            settings.Audit.Endpoint,
            new GrpcChannelOptions
            {
                MaxReceiveMessageSize = 64 * 1024,
                MaxSendMessageSize = 64 * 1024
            });

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
            options.Listen(
                settings.Aggregation.Address,
                settings.Aggregation.Port,
                listen =>
                {
                    listen.Protocols = HttpProtocols.Http1AndHttp2;
                    listen.UseHttps(https =>
                    {
                        https.ServerCertificate =
                            aggregationCertificates.ServerCertificate;
                        https.ClientCertificateMode =
                            ClientCertificateMode.RequireCertificate;
                        https.ClientCertificateValidation =
                            (certificate, chain, errors) =>
                                ValidateAggregationClientCertificate(
                                    certificate,
                                    chain,
                                    errors,
                                    aggregationCertificates
                                        .RequestHeaderRoot,
                                    settings.Aggregation
                                        .AllowedClientNames);
                    });
                });
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
                settings.ResolveWorkspaceCallers,
                settings.GetLifecycleCallers,
                settings.LifecycleOwners,
                settings.PageCursorLifetime,
                settings.WatchLifetime));
        builder.Services.AddSingleton(CreateTenancyJsonContext());
        builder.Services.AddSingleton<IDbContextFactory<TenantDbContext>>(
            databaseContexts);
        builder.Services.AddSingleton(tokenAuthorities);
        builder.Services.AddSingleton(settings.Audit);
        builder.Services.AddSingleton(auditChannel);
        builder.Services.AddSingleton(
            new AuditService.AuditServiceClient(auditChannel));
        builder.Services.AddHostedService<AuditDispatcher>();

        await using var application = builder.Build();
        UseAggregationBoundary(application, settings);
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
                    var schema = await VerifySchema(contexts, cancellation);
                    var audit = schema == SchemaCompatibility.Compatible
                        ? await QueryAuditOutboxReadiness(
                            contexts,
                            cancellation)
                        : AuditOutboxReadiness.Inconsistent;
                    return schema == SchemaCompatibility.Compatible
                        && audit == AuditOutboxReadiness.Ready
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
        MapTenancyApi(application);

        await application.RunAsync();
        return 0;
    }
}
