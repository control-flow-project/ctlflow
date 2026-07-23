using System.Diagnostics;
using Microsoft.Extensions.Logging;
using OpenTelemetry.Logs;

namespace CtlFlow.Tenancy.Tenantd.Service.Telemetry;

internal static partial class TelemetryConfiguration
{
    internal static void ConfigureTelemetry(
        WebApplicationBuilder builder,
        TelemetrySettings settings)
    {
        Activity.DefaultIdFormat = ActivityIdFormat.W3C;
        Activity.ForceDefaultIdFormat = true;

        builder.Logging.ClearProviders();
        builder.Logging.AddOpenTelemetry(options =>
        {
            options.SetResourceBuilder(TenantdTelemetry.CreateResource());
            options.IncludeFormattedMessage = false;
            options.IncludeScopes = true;
            options.ParseStateValues = true;
            options.AddOtlpExporter((exporter, processor) =>
            {
                exporter.Endpoint = settings.LogsEndpoint;
                exporter.Protocol =
                    OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
                exporter.TimeoutMilliseconds = 1_000;
                processor.BatchExportProcessorOptions.MaxQueueSize = 2_048;
                processor.BatchExportProcessorOptions
                    .ScheduledDelayMilliseconds = 200;
                processor.BatchExportProcessorOptions
                    .ExporterTimeoutMilliseconds = 1_000;
                processor.BatchExportProcessorOptions.MaxExportBatchSize = 512;
            });
        });

        builder.Services.AddSingleton<TenantdTelemetry>(services =>
            new TenantdTelemetry(
                settings,
                services.GetRequiredService<ILogger<TenantdTelemetry>>()));
    }
}
