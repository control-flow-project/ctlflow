using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Db.Schema;
using CtlFlow.Execution.Execd.Service.Grpc;
using CtlFlow.Execution.Execd.Service.Hosting.Tls;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Reconciliation;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Invocations;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Identity.V1;
using CtlFlow.Packages.V1;
using CtlFlow.Policy.V1;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Execution.Execd.Db.Providers.ExecutionDatabaseProviders;
using static CtlFlow.Execution.Execd.Db.Schema.Schemas;
using static CtlFlow.Execution.Execd.Service.Configuration.ExecdConfiguration;
using static CtlFlow.Execution.Execd.Service.Hosting.Tls.GrpcTls;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Security.Invocations.InvocationVerificationKeys;
using static CtlFlow.Execution.Execd.Service.Security.Tokens.JsonWebKeys;
using static CtlFlow.Execution.Execd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Execution.Execd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Execution.Execd.Service.Hosting;

internal static partial class ExecdProcess
{
    internal static async Task<int> RunExecd(string[] args)
    {
        var settings = await LoadServiceSettings(
            CancellationToken.None);
        var database = await CreateExecutionDatabase(
            settings.Database,
            CancellationToken.None);
        using var auditChannel = CreatePrivateGrpcChannel(
            settings.Audit.Grpc,
            settings.Audit.CallTimeout);
        using var identityChannel = CreatePrivateGrpcChannel(
            settings.Identity.Grpc,
            settings.Identity.CallTimeout);
        using var policyChannel = CreatePrivateGrpcChannel(
            settings.Policy.Grpc,
            settings.Policy.CallTimeout);
        using var packageChannel = CreatePrivateGrpcChannel(
            settings.Package.Grpc,
            settings.Package.CallTimeout);
        using var configurationChannel = CreatePrivateGrpcChannel(
            settings.Configuration.Grpc,
            settings.Configuration.CallTimeout);
        var identityClient =
            new IdentityService.IdentityServiceClient(identityChannel);
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
            options.Interceptors.Add<ExecdInterceptor>();
        });
        builder.Services.AddSingleton<ExecdInterceptor>();
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(database);
        builder.Services.AddSingleton(tokenAuthorities);
        builder.Services.AddSingleton(
            new AuditService.AuditServiceClient(auditChannel));
        builder.Services.AddSingleton(identityClient);
        builder.Services.AddSingleton(
            new PolicyService.PolicyServiceClient(policyChannel));
        builder.Services.AddSingleton(
            new PackageService.PackageServiceClient(packageChannel));
        builder.Services.AddSingleton(
            new ConfigurationService.ConfigurationServiceClient(
                configurationChannel));
        builder.Services.AddSingleton(serviceProvider =>
            CreateKubernetesApi(
                settings.Kubernetes,
                serviceProvider.GetRequiredService<ExecdTelemetry>()));
        builder.Services.AddHostedService<ExecutionReconciler>();

        await using var application = builder.Build();
        application.Use(async (context, next) =>
        {
            var isProbeListener =
                context.Connection.LocalPort == settings.ProbePort;
            var isProbePath = context.Request.Path == "/healthz"
                || context.Request.Path == "/readyz";
            if (isProbeListener != isProbePath)
            {
                context.Response.StatusCode =
                    StatusCodes.Status404NotFound;
                return;
            }

            await next(context);
        });
        application.MapGrpcService<ExecutionGrpcService>();
        application.MapGet(
            "/healthz",
            static () => Results.NoContent());
        application.MapGet(
            "/readyz",
            async (
                ExecutionDatabase readyDatabase,
                KubernetesApi kubernetes,
                CancellationToken cancellation) =>
            {
                try
                {
                    var schema = await VerifySchema(
                        readyDatabase,
                        cancellation);
                    var credentials =
                        await VerifyKubernetesCredentials(
                            kubernetes,
                            cancellation);
                    return schema == SchemaCompatibility.Compatible
                        && credentials
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
