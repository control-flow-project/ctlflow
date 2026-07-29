using CtlFlow.Edge.Edged.Service.Admission;
using CtlFlow.Edge.Edged.Service.Configuration;
using CtlFlow.Edge.Edged.Service.Telemetry;
using CtlFlow.Identity.V1;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Edge.Edged.Service.Configuration.EdgedConfiguration;
using static CtlFlow.Edge.Edged.Service.Http.PublicBoundary;
using static CtlFlow.Edge.Edged.Service.Proxy.ApplicationProxy;
using static CtlFlow.Edge.Edged.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Edge.Edged.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Edge.Edged.Service.Hosting;

internal static partial class EdgedProcess
{
    internal static async Task<int> RunEdged(string[] args)
    {
        var settings = await LoadServiceSettings(
            CancellationToken.None);
        var identityChannel = CreatePrivateGrpcChannel(
            settings.Identity.Grpc,
            settings.Identity.CallTimeout);
        var applicationClient = CreateApplicationClient(settings.Proxy);
        var builder = WebApplication.CreateEmptyBuilder(
            new WebApplicationOptions
            {
                Args = args
            });
        builder.Services.AddLogging();
        builder.WebHost.UseKestrelCore();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxConcurrentConnections = 512;
            options.Limits.MaxConcurrentUpgradedConnections = 0;
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(30);
            options.Limits.MaxRequestBodySize = null;
            options.Limits.MaxRequestBufferSize = 64 * 1024;
            options.Limits.MaxResponseBufferSize = 64 * 1024;
            options.Limits.MaxRequestHeaderCount = 4_096;
            options.Limits.MaxRequestHeadersTotalSize = 40 * 1024;
            options.Limits.MaxRequestLineSize = 20 * 1024;
            options.Limits.RequestHeadersTimeout =
                TimeSpan.FromSeconds(5);
            options.Listen(
                settings.Public.Address,
                settings.Public.Port,
                listen => listen.Protocols = HttpProtocols.Http1);
            options.Listen(
                settings.Probe.Address,
                settings.Probe.Port,
                listen => listen.Protocols = HttpProtocols.Http1);
        });

        ConfigureTelemetry(builder, settings.Telemetry);
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(
            new PublicAdmission(settings.Proxy.MaximumConcurrency));
        builder.Services.AddSingleton(identityChannel);
        builder.Services.AddSingleton(
            new IdentityService.IdentityServiceClient(identityChannel));
        builder.Services.AddSingleton(applicationClient);

        await using var application = builder.Build();
        application.Run(async context =>
        {
            if (context.Connection.LocalPort == settings.Probe.Port)
            {
                await HandleProbeRequest(context);
                return;
            }

            await HandlePublicRequest(
                context,
                settings,
                context.RequestServices
                    .GetRequiredService<PublicAdmission>(),
                context.RequestServices
                    .GetRequiredService<
                        IdentityService.IdentityServiceClient>(),
                context.RequestServices
                    .GetRequiredService<HttpClient>(),
                context.RequestServices
                    .GetRequiredService<EdgedTelemetry>());
        });
        await application.RunAsync();
        return 0;
    }
}
