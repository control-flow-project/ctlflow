using System.Diagnostics;
using System.Diagnostics.Metrics;
using Grpc.Core;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CtlFlow.Tenancy.Tenantd.Service.Telemetry;

internal sealed class TenantdTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.tenantd";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<ILogger, string, double, Exception?>
        LogResolveTenantCompletion = LoggerMessage.Define<string, double>(
            LogLevel.Information,
            new EventId(1, "ResolveTenantCompleted"),
            "ResolveTenant completed with {Outcome} in {DurationMilliseconds} ms");
    private static readonly Action<ILogger, string, double, Exception?>
        LogResolveWorkspaceCompletion = LoggerMessage.Define<string, double>(
            LogLevel.Information,
            new EventId(2, "ResolveWorkspaceCompleted"),
            "ResolveWorkspace completed with {Outcome} in {DurationMilliseconds} ms");
    private readonly ActivitySource _activitySource = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<TenantdTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Histogram<double> _duration;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal TenantdTelemetry(
        TelemetrySettings settings,
        ILogger<TenantdTelemetry> logger)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.tenantd.requests",
            description: "Completed tenantd operations");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.tenantd.duration",
            unit: "ms",
            description: "tenantd operation duration");

        _traces = Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .SetSampler(new AlwaysOnSampler())
            .AddSource(SourceName)
            .AddSource(CtlFlow.Tenancy.Tenantd.Db.TenantDbTelemetry.SourceName)
            .AddOtlpExporter(options =>
            {
                options.Endpoint = settings.TracesEndpoint;
                options.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
                options.TimeoutMilliseconds = ExportTimeoutMilliseconds;
                options.ExportProcessorType = ExportProcessorType.Batch;
                options.BatchExportProcessorOptions =
                    new BatchExportActivityProcessorOptions
                    {
                        MaxQueueSize = 2_048,
                        ScheduledDelayMilliseconds = 200,
                        ExporterTimeoutMilliseconds = ExportTimeoutMilliseconds,
                        MaxExportBatchSize = 512
                    };
            })
            .Build();

        _metrics = Sdk.CreateMeterProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .AddMeter(SourceName)
            .AddOtlpExporter(
                (options, reader) =>
                {
                    options.Endpoint = settings.MetricsEndpoint;
                    options.Protocol =
                        OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
                    options.TimeoutMilliseconds = ExportTimeoutMilliseconds;
                    reader.PeriodicExportingMetricReaderOptions
                        .ExportIntervalMilliseconds = 1_000;
                    reader.PeriodicExportingMetricReaderOptions
                        .ExportTimeoutMilliseconds = ExportTimeoutMilliseconds;
                })
            .Build();
    }

    internal Activity? StartResolveTenant(Metadata headers) =>
        StartOperation("tenantd.ResolveTenant", "ResolveTenant", headers);

    internal void RecordResolveTenant(
        Activity? activity,
        string outcome,
        long startedTimestamp) =>
        RecordOperation(
            activity,
            "ResolveTenant",
            outcome,
            startedTimestamp,
            LogResolveTenantCompletion);

    internal Activity? StartResolveWorkspace(Metadata headers) =>
        StartOperation("tenantd.ResolveWorkspace", "ResolveWorkspace", headers);

    internal void RecordResolveWorkspace(
        Activity? activity,
        string outcome,
        long startedTimestamp) =>
        RecordOperation(
            activity,
            "ResolveWorkspace",
            outcome,
            startedTimestamp,
            LogResolveWorkspaceCompletion);

    private Activity? StartOperation(
        string activityName,
        string method,
        Metadata headers)
    {
        var parent = ReadParentContext(headers);
        var activity = _activitySource.StartActivity(
            activityName,
            ActivityKind.Server,
            parent);
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag("rpc.service", "ctlflow.tenancy.v1.TenantService");
        activity?.SetTag("rpc.method", method);
        return activity;
    }

    private void RecordOperation(
        Activity? activity,
        string operation,
        string outcome,
        long startedTimestamp,
        Action<ILogger, string, double, Exception?> log)
    {
        var durationMilliseconds =
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;
        var tags = new TagList
        {
            { "ctlflow.operation", operation },
            { "ctlflow.outcome", outcome }
        };
        _requests.Add(1, tags);
        _duration.Record(durationMilliseconds, tags);
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetStatus(
            outcome == "ok"
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        log(
            _logger,
            outcome,
            durationMilliseconds,
            null);
    }

    public void Dispose()
    {
        _metrics.Dispose();
        _traces.Dispose();
        _meter.Dispose();
        _activitySource.Dispose();
    }

    internal static ResourceBuilder CreateResource() =>
        ResourceBuilder.CreateEmpty()
            .AddService(
                serviceName: "tenantd",
                serviceNamespace: "ctlflow",
                serviceVersion: typeof(TenantdTelemetry).Assembly
                    .GetName()
                    .Version?
                    .ToString() ?? "0.0.0");

    private static ActivityContext ReadParentContext(Metadata headers)
    {
        var traceParent = ReadSingleHeader(headers, "traceparent", 128);
        var traceState = ReadSingleHeader(headers, "tracestate", 512);

        return traceParent is not null
            && ActivityContext.TryParse(
                traceParent,
                traceState,
                isRemote: true,
                out var parent)
            ? parent
            : default;
    }

    private static string? ReadSingleHeader(
        Metadata headers,
        string name,
        int maximumLength)
    {
        string? value = null;

        foreach (var header in headers)
        {
            if (!string.Equals(
                    header.Key,
                    name,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (header.IsBinary
                || value is not null
                || header.Value.Length > maximumLength)
            {
                return null;
            }

            value = header.Value;
        }

        return value;
    }
}
