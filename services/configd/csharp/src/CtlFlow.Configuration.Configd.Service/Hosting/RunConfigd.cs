using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Db.Schema;
using CtlFlow.Configuration.Configd.Service.Grpc;
using CtlFlow.Configuration.Configd.Service.Hosting.Tls;
using CtlFlow.Configuration.Configd.Service.Kubernetes;
using CtlFlow.Configuration.Configd.Service.Security;
using CtlFlow.Configuration.Configd.Service.Security.Invocations;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using CtlFlow.Configuration.Configd.Service.Telemetry;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.V1;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustody;
using static CtlFlow.Configuration.Configd.Db.Providers.ConfigurationDatabaseProviders;
using static CtlFlow.Configuration.Configd.Db.Schema.Schemas;
using static CtlFlow.Configuration.Configd.Service.Configuration.ConfigdConfiguration;
using static CtlFlow.Configuration.Configd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Configuration.Configd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Configuration.Configd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Configuration.Configd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Configuration.Configd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Configuration.Configd.Service.Hosting;

internal static partial class ConfigdProcess
{
    internal static async Task<int> RunConfigd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        var configurationDatabase = await CreateConfigurationDatabase(
            settings.Database,
            CancellationToken.None);
        var encryptionKeys = await LoadEncryptionKeyRing(
            settings.EncryptionKeyRingPath,
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
            options.MaxReceiveMessageSize = 73_728;
            options.MaxSendMessageSize = 73_728;
            options.Interceptors.Add<ConfigdInterceptor>();
        });
        builder.Services.AddSingleton<ConfigdInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(configurationDatabase);
        builder.Services.AddSingleton(encryptionKeys);
        builder.Services.AddSingleton(tokenAuthorities);
        builder.Services.AddSingleton(
            new AuditService.AuditServiceClient(auditChannel));
        builder.Services.AddSingleton(
            new PolicyService.PolicyServiceClient(policyChannel));
        builder.Services.AddSingleton<KubernetesApi>(services =>
            CreateKubernetesApi(
                settings.Kubernetes,
                services.GetRequiredService<ConfigdTelemetry>()));

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
        application.MapGrpcService<ConfigurationGrpcService>();
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                ConfigurationDatabase database,
                EncryptionKeyRing keyRing,
                KubernetesApi kubernetes,
                CancellationToken cancellation) =>
            {
                try
                {
                    var schema = await VerifySchema(
                        database,
                        cancellation);
                    var keyCoverage = schema
                            == SchemaCompatibility.Compatible
                        && await VerifyEncryptionKeyCoverage(
                            database,
                            keyRing,
                            cancellation);
                    var kubernetesCredentials =
                        await VerifyKubernetesCredentials(
                            kubernetes,
                            cancellation);
                    return keyCoverage && kubernetesCredentials
                        ? Results.NoContent()
                        : Results.StatusCode(
                            StatusCodes.Status503ServiceUnavailable);
                }
                catch (Exception exception) when (
                    exception is DbException
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
