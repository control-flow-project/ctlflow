using System.Diagnostics;
using OpenTelemetry.Logs;

namespace CtlFlow.Auth.Authd.Service.Telemetry;

internal static partial class TelemetryConfiguration
{
    internal static void ConfigureTelemetry(
        WebApplicationBuilder builder,
        TelemetrySettings settings)
    {
        Activity.DefaultIdFormat = ActivityIdFormat.W3C;
        Activity.ForceDefaultIdFormat = true;

        builder.Logging.ClearProviders();
        builder.Logging.AddFilter(
            static (category, level) =>
                category
                    == "CtlFlow.Auth.Authd.Service.Telemetry.AuthdTelemetry"
                && level >= LogLevel.Information);
        builder.Logging.AddOpenTelemetry(options =>
        {
            options.SetResourceBuilder(AuthdTelemetry.CreateResource());
            options.IncludeFormattedMessage = false;
            options.IncludeScopes = false;
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
                processor.BatchExportProcessorOptions.MaxExportBatchSize =
                    512;
            });
        });
        builder.Services.AddSingleton<AuthdTelemetry>(services =>
            new AuthdTelemetry(
                settings,
                services.GetRequiredService<ILogger<AuthdTelemetry>>(),
                services.GetRequiredService<
                    Admission.PublicAdmission>(),
                services.GetRequiredService<
                    State.AuthenticationAttemptStore>()));
    }
}
