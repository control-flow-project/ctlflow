using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.V1;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Service.Grpc;
using CtlFlow.Tenancy.Tenantd.Service.Hosting.Tls;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Tenancy.Tenantd.Db.Providers.TenantDatabaseProviders;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Service.Configuration.TenantdConfiguration;
using static CtlFlow.Tenancy.Tenantd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Tenancy.Tenantd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Tenancy.Tenantd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Tenancy.Tenantd.Service.Hosting;

internal static partial class TenantdProcess
{
    internal static async Task<int> RunTenantd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        var tenantDatabase = await CreateTenantDatabase(
            settings.Database,
            CancellationToken.None);
        using var auditChannel = CreatePrivateGrpcChannel(
            settings.Audit.Grpc);
        using var identityChannel = CreatePrivateGrpcChannel(
            settings.Identity.Grpc);
        using var policyChannel = CreatePrivateGrpcChannel(
            settings.Policy.Grpc);
        var identityClient = new IdentityService.IdentityServiceClient(
            identityChannel);
        var tokenAuthorities = new TokenAuthorities(
            settings.WorkloadTokens.Validation,
            new VerificationKeys(cancellation =>
                LoadFileVerificationKeys(
                    settings.WorkloadTokens.VerificationKeySetPath,
                    settings.WorkloadTokens.KeyCacheLifetime,
                    cancellation)),
            settings.InvocationTokens,
            new VerificationKeys(cancellation =>
                LoadInvocationVerificationKeys(
                    identityClient,
                    settings.Identity,
                    cancellation)));

        var builder = WebApplication.CreateSlimBuilder(args);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(
                settings.GrpcAddress,
                settings.GrpcPort,
                listen =>
                {
                    listen.Protocols = HttpProtocols.Http2;
                    listen.UseHttps(
                        tls => ConfigureGrpcTls(tls, settings.Tls));
                });
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
            options.Interceptors.Add<TenantdInterceptor>();
        });
        builder.Services.AddSingleton<TenantdInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(tenantDatabase);
        builder.Services.AddSingleton(tokenAuthorities);
        builder.Services.AddSingleton(
            new AuditService.AuditServiceClient(auditChannel));
        builder.Services.AddSingleton(
            new PolicyService.PolicyServiceClient(policyChannel));

        await using var application = builder.Build();
        application.Use(async (context, next) =>
        {
            var isProbeListener =
                context.Connection.LocalPort == settings.ProbePort;
            var isProbePath = context.Request.Path == "/healthz"
                || context.Request.Path == "/readyz";
            if (isProbeListener != isProbePath)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            await next(context);
        });
        application.MapGrpcService<TenantGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                TenantDatabase database,
                CancellationToken cancellation) =>
            {
                try
                {
                    return await VerifySchema(database, cancellation)
                        == SchemaCompatibility.Compatible
                        ? Results.NoContent()
                        : Results.StatusCode(
                            StatusCodes.Status503ServiceUnavailable);
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
