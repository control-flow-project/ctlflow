using System.Data.Common;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Service.Catalog;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Grpc;
using CtlFlow.Policy.Policyd.Service.Hosting.Tls;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Policy.Policyd.Db.Providers.PolicyDatabaseProviders;
using static CtlFlow.Policy.Policyd.Service.Catalog.Catalogs;
using static CtlFlow.Policy.Policyd.Service.Configuration.PolicydConfiguration;
using static CtlFlow.Policy.Policyd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Policy.Policyd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Policy.Policyd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Policy.Policyd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Policy.Policyd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Policy.Policyd.Service.Hosting;

internal static partial class PolicydProcess
{
    internal static async Task<int> RunPolicyd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        ValidatedCatalog catalog = await LoadOperationCatalog(
            settings.CatalogPath,
            CancellationToken.None);
        var policyDatabase = await CreatePolicyDatabase(
            settings.Database,
            CancellationToken.None);
        using var identityChannel = CreatePrivateGrpcChannel(
            settings.Identity.Grpc);
        var identityClient = new IdentityService.IdentityServiceClient(
            identityChannel);

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
            options.Interceptors.Add<PolicydInterceptor>();
        });
        builder.Services.AddSingleton<PolicydInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(catalog);
        builder.Services.AddSingleton(policyDatabase);
        builder.Services.AddSingleton(identityClient);
        builder.Services.AddSingleton<TokenAuthorities>(services =>
            new TokenAuthorities(
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
                        services.GetRequiredService<PolicydTelemetry>(),
                        cancellation))));

        await using var application = builder.Build();
        _ = application.Services.GetRequiredService<TokenAuthorities>();
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
        application.MapGrpcService<PolicyGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                ServiceSettings currentSettings,
                PolicyDatabase database,
                CancellationToken cancellation) =>
            {
                try
                {
                    return await VerifyReadiness(
                        currentSettings,
                        database,
                        cancellation)
                        ? Results.NoContent()
                        : Results.StatusCode(
                            StatusCodes.Status503ServiceUnavailable);
                }
                catch (Exception exception) when (
                    exception is CatalogUnavailableException
                        or TokenKeySourceException
                        or DbException
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
