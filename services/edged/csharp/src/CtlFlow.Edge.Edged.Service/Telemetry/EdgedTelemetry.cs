using System.Diagnostics;
using System.Diagnostics.Metrics;
using Grpc.Core;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CtlFlow.Edge.Edged.Service.Telemetry;

internal sealed class EdgedTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.edged";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<
        ILogger,
        string,
        string,
        int,
        double,
        Exception?> LogCompletion =
        LoggerMessage.Define<string, string, int, double>(
            LogLevel.Information,
            new EventId(1, "EdgedRequestCompleted"),
            "{Operation} completed with {Outcome}, status {StatusCode}, "
            + "in {DurationMilliseconds} ms");
    private readonly ActivitySource _activitySource = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<EdgedTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Histogram<double> _duration;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal EdgedTelemetry(
        TelemetrySettings settings,
        ILogger<EdgedTelemetry> logger)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.edged.requests",
            description: "Completed edged requests");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.edged.duration",
            unit: "ms",
            description: "edged request duration");
        _traces = Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .SetSampler(new AlwaysOnSampler())
            .AddSource(SourceName)
            .AddOtlpExporter(options =>
            {
                options.Endpoint = settings.TracesEndpoint;
                options.Protocol =
                    OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
                options.TimeoutMilliseconds = ExportTimeoutMilliseconds;
                options.ExportProcessorType = ExportProcessorType.Batch;
                options.BatchExportProcessorOptions =
                    new BatchExportActivityProcessorOptions
                    {
                        MaxQueueSize = 2_048,
                        ScheduledDelayMilliseconds = 200,
                        ExporterTimeoutMilliseconds =
                            ExportTimeoutMilliseconds,
                        MaxExportBatchSize = 512
                    };
            })
            .Build();
        _metrics = Sdk.CreateMeterProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .AddMeter(SourceName)
            .AddOtlpExporter((options, reader) =>
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

    internal Activity? StartHttpOperation(
        string operation,
        string method,
        IHeaderDictionary headers)
    {
        var activity = _activitySource.StartActivity(
            operation,
            ActivityKind.Server,
            ReadParentContext(headers));
        activity?.SetTag("http.request.method", method);
        activity?.SetTag("ctlflow.operation", operation);
        return activity;
    }

    internal Activity? StartDependency(string operation)
    {
        var activity = _activitySource.StartActivity(
            operation,
            ActivityKind.Client);
        activity?.SetTag("ctlflow.operation", operation);
        return activity;
    }

    internal void RecordDependency(
        Activity? activity,
        string outcome,
        long startedTimestamp)
    {
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetTag(
            "ctlflow.duration_ms",
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds);
        activity?.SetStatus(
            outcome == "ok"
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
    }

    internal void RecordHttpOperation(
        Activity? activity,
        string operation,
        string outcome,
        int statusCode,
        long startedTimestamp)
    {
        var elapsed =
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;
        var tags = new TagList
        {
            { "ctlflow.operation", operation },
            { "ctlflow.outcome", outcome },
            { "http.response.status_code", statusCode }
        };
        _requests.Add(1, tags);
        _duration.Record(elapsed, tags);
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetTag("http.response.status_code", statusCode);
        activity?.SetStatus(
            statusCode < 500
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        var previous = Activity.Current;
        try
        {
            Activity.Current = activity;
            LogCompletion(
                _logger,
                operation,
                outcome,
                statusCode,
                elapsed,
                null);
        }
        finally
        {
            Activity.Current = previous;
        }
    }

    internal static void InjectTraceContext(Metadata headers)
    {
        var activity = Activity.Current;
        if (activity?.Id is null)
        {
            return;
        }

        headers.Add("traceparent", activity.Id);
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }

    internal static void InjectTraceContext(HttpRequestMessage request)
    {
        var activity = Activity.Current;
        if (activity?.Id is null)
        {
            return;
        }

        request.Headers.TryAddWithoutValidation(
            "traceparent",
            activity.Id);
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            request.Headers.TryAddWithoutValidation(
                "tracestate",
                activity.TraceStateString);
        }
    }

    internal static ResourceBuilder CreateResource() =>
        ResourceBuilder.CreateEmpty()
            .AddService(
                serviceName: "edged",
                serviceNamespace: "ctlflow",
                serviceVersion: typeof(EdgedTelemetry).Assembly
                    .GetName()
                    .Version?
                    .ToString() ?? "0.0.0");

    public void Dispose()
    {
        _metrics.Dispose();
        _traces.Dispose();
        _meter.Dispose();
        _activitySource.Dispose();
    }

    private static ActivityContext ReadParentContext(
        IHeaderDictionary headers)
    {
        var traceParent = ReadSingleHeader(
            headers,
            "traceparent",
            128);
        var traceState = ReadSingleHeader(
            headers,
            "tracestate",
            512);
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
        IHeaderDictionary headers,
        string name,
        int maximumLength)
    {
        var values = headers[name];
        return values.Count == 1
            && values[0] is { } value
            && value.Length <= maximumLength
            ? value
            : null;
    }
}
