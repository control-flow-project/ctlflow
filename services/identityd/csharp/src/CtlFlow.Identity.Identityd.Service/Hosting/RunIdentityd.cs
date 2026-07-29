using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Db.Schema;
using CtlFlow.Identity.Identityd.Service.Grpc;
using CtlFlow.Identity.Identityd.Service.Security;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using CtlFlow.Identity.Identityd.Service.Security.Signing;
using CtlFlow.Identity.Identityd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Identity.Identityd.Db.Providers.IdentityDatabaseProviders;
using static CtlFlow.Identity.Identityd.Db.Schema.Schemas;
using static CtlFlow.Identity.Identityd.Service.Configuration.IdentitydConfiguration;
using static CtlFlow.Identity.Identityd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Identity.Identityd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Identity.Identityd.Service.Security.Signing.InvocationSigningKeys;
using static CtlFlow.Identity.Identityd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Identity.Identityd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Identity.Identityd.Service.Hosting;

internal static partial class IdentitydProcess
{
    internal static async Task<int> RunIdentityd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        var identityDatabase = await CreateIdentityDatabase(
            settings.Database,
            CancellationToken.None);
        var signingKey = await LoadInvocationSigningKey(
            identityDatabase,
            settings.Signing,
            CancellationToken.None);
        using var auditChannel = CreatePrivateGrpcChannel(
            settings.Audit.Grpc);
        var tokenAuthorities = new TokenAuthorities(
            settings.WorkloadTokens.Validation,
            new VerificationKeys(cancellation =>
                LoadFileVerificationKeys(
                    settings.WorkloadTokens.VerificationKeySetPath,
                    settings.WorkloadTokens.KeyCacheLifetime,
                    cancellation)),
            settings.EdgedTokens,
            settings.InvocationTokens,
            new VerificationKeys(cancellation =>
                LoadInvocationVerificationKeys(
                    identityDatabase,
                    settings.InvocationKeyCacheLifetime,
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
            options.Interceptors.Add<IdentitydInterceptor>();
        });
        builder.Services.AddSingleton<IdentitydInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(identityDatabase);
        builder.Services.AddSingleton(tokenAuthorities);
        builder.Services.AddSingleton(signingKey);
        builder.Services.AddSingleton(
            new AuditService.AuditServiceClient(auditChannel));

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
        application.MapGrpcService<IdentityGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                IdentityDatabase database,
                InvocationSigningKey activeSigningKey,
                CancellationToken cancellation) =>
            {
                try
                {
                    if (await VerifySchema(database, cancellation)
                            != SchemaCompatibility.Compatible)
                    {
                        return Results.StatusCode(
                            StatusCodes.Status503ServiceUnavailable);
                    }

                    await VerifyInvocationSigningKey(
                        database,
                        activeSigningKey,
                        cancellation);
                    return Results.NoContent();
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
