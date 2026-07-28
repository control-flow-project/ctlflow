using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.V1;
using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Db.Schema;
using CtlFlow.Packages.Pkgd.Service.Grpc;
using CtlFlow.Packages.Pkgd.Service.Hosting.Tls;
using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Invocations;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Packages.Pkgd.Db.Providers.PackageDatabaseProviders;
using static CtlFlow.Packages.Pkgd.Db.Schema.Schemas;
using static CtlFlow.Packages.Pkgd.Service.Configuration.PkgdConfiguration;
using static CtlFlow.Packages.Pkgd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Packages.Pkgd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Packages.Pkgd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Packages.Pkgd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Packages.Pkgd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Packages.Pkgd.Service.Hosting;

internal static partial class PkgdProcess
{
    internal static async Task<int> RunPkgd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        var packageDatabase = await CreatePackageDatabase(
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
            options.MaxReceiveMessageSize = 1_048_576;
            options.MaxSendMessageSize = 1_048_576;
            options.Interceptors.Add<PkgdInterceptor>();
        });
        builder.Services.AddSingleton<PkgdInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(packageDatabase);
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
        application.MapGrpcService<PackageGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                PackageDatabase database,
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
