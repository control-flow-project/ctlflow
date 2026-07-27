using System.Data.Common;
using CtlFlow.Audit.Auditd.Db.Providers;
using CtlFlow.Audit.Auditd.Db.Schema;
using CtlFlow.Audit.Auditd.Service.Grpc;
using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Audit.Auditd.Db.Providers.AuditDatabaseProviders;
using static CtlFlow.Audit.Auditd.Db.Schema.Schemas;
using static CtlFlow.Audit.Auditd.Service.Configuration.AuditdConfiguration;
using static CtlFlow.Audit.Auditd.Service.Security.AuditSourceAuthentication;
using static CtlFlow.Audit.Auditd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Audit.Auditd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Audit.Auditd.Service.Hosting.Tls.GrpcTls;

namespace CtlFlow.Audit.Auditd.Service.Hosting;

internal static partial class AuditdProcess
{
    internal static async Task<int> RunAuditd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        await VerifyWorkloadTrust(
            settings.WorkloadTokens.VerificationKeySetPath,
            settings.WorkloadTokens.KeyCacheLifetime,
            CancellationToken.None);
        await using var auditDatabase = await CreateAuditDatabase(
            settings.Database,
            CancellationToken.None);
        var verificationKeys = new VerificationKeys(cancellation =>
            LoadFileVerificationKeys(
                settings.WorkloadTokens.VerificationKeySetPath,
                settings.WorkloadTokens.KeyCacheLifetime,
                cancellation));

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
            options.MaxReceiveMessageSize = 256 * 1024;
            options.MaxSendMessageSize = 64 * 1024;
            options.Interceptors.Add<AuditdInterceptor>();
        });
        builder.Services.AddSingleton<AuditdInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(auditDatabase);
        builder.Services.AddSingleton(verificationKeys);

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
        application.MapGrpcService<AuditGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (CancellationToken cancellation) =>
            {
                try
                {
                    var schema = await VerifySchema(
                        auditDatabase,
                        cancellation);
                    if (schema != SchemaCompatibility.Compatible)
                    {
                        return Results.StatusCode(
                            StatusCodes.Status503ServiceUnavailable);
                    }

                    await VerifyWorkloadTrust(
                        settings.WorkloadTokens.VerificationKeySetPath,
                        settings.WorkloadTokens.KeyCacheLifetime,
                        cancellation);
                    return Results.NoContent();
                }
                catch (Exception exception) when (
                    exception is DbException
                        or DbUpdateException
                        or IOException
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
