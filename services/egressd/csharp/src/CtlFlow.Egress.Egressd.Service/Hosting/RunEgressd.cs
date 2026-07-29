using CtlFlow.Egress.Egressd.Service.Admission;
using CtlFlow.Egress.Egressd.Service.Configuration;
using CtlFlow.Egress.Egressd.Service.Telemetry;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Egress.Egressd.Service.Configuration.EgressdConfiguration;
using static CtlFlow.Egress.Egressd.Service.Http.PrivateBoundary;
using static CtlFlow.Egress.Egressd.Service.Proxy.EgressProxy;
using static CtlFlow.Egress.Egressd.Service.Telemetry.TelemetryConfiguration;

namespace CtlFlow.Egress.Egressd.Service.Hosting;

internal static partial class EgressdProcess
{
    internal static async Task<int> RunEgressd(string[] args)
    {
        await using var settings = await LoadServiceSettings(
            CancellationToken.None);
        using var upstream = CreateUpstreamClient(settings.Proxy);
        var builder = WebApplication.CreateEmptyBuilder(
            new WebApplicationOptions
            {
                Args = args
            });
        builder.Services.AddLogging();
        builder.WebHost.UseKestrelCore();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
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
                settings.Private.Address,
                settings.Private.Port,
                listen => listen.Protocols =
                    HttpProtocols.Http1AndHttp2);
            options.Listen(
                settings.Probe.Address,
                settings.Probe.Port,
                listen => listen.Protocols = HttpProtocols.Http1);
        });

        ConfigureTelemetry(builder, settings.Telemetry);
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(
            new PrivateAdmission(settings.Proxy.MaximumConcurrency));
        builder.Services.AddSingleton(upstream);

        await using var application = builder.Build();
        application.Run(async context =>
        {
            if (context.Connection.LocalPort == settings.Probe.Port)
            {
                await HandleProbeRequest(context);
                return;
            }
            await HandlePrivateRequest(
                context,
                settings,
                context.RequestServices
                    .GetRequiredService<PrivateAdmission>(),
                context.RequestServices.GetRequiredService<HttpClient>(),
                context.RequestServices
                    .GetRequiredService<EgressdTelemetry>());
        });
        await application.RunAsync();
        return 0;
    }
}
