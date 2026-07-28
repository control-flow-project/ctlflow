using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Globalization;
using Grpc.Core;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CtlFlow.Policy.Policyd.Service.Telemetry;

internal sealed class PolicydTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.policyd";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<ILogger, string, string, double, Exception?>
        LogCompletion = LoggerMessage.Define<string, string, double>(
            LogLevel.Information,
            new EventId(1, "PolicydOperationCompleted"),
            "{Operation} completed with {Outcome} in {DurationMilliseconds} ms");
    private readonly ActivitySource _activities = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<PolicydTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Counter<long> _decisions;
    private readonly Histogram<double> _duration;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal PolicydTelemetry(
        TelemetrySettings settings,
        ILogger<PolicydTelemetry> logger)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.policyd.requests",
            description: "Completed Policyd operations");
        _decisions = _meter.CreateCounter<long>(
            "ctlflow.policyd.decisions",
            description: "Completed Policyd access decisions");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.policyd.duration",
            unit: "ms",
            description: "Policyd operation duration");
        _traces = Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .SetSampler(new AlwaysOnSampler())
            .AddSource(SourceName)
            .AddSource(CtlFlow.Policy.Policyd.Db.PolicyDbTelemetry.SourceName)
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

    internal Activity? StartGrpcOperation(Metadata headers)
    {
        var activity = _activities.StartActivity(
            "policyd.CheckAccess",
            ActivityKind.Server,
            ReadParentContext(headers));
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag(
            "rpc.service",
            "ctlflow.policy.v1.PolicyService");
        activity?.SetTag("rpc.method", "CheckAccess");
        return activity;
    }

    internal void RecordGrpcOperation(
        Activity? activity,
        string outcome,
        string? decision,
        long startedTimestamp)
    {
        var elapsed =
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;
        var tags = new TagList
        {
            { "ctlflow.operation", "CheckAccess" },
            { "ctlflow.outcome", outcome }
        };
        _requests.Add(1, tags);
        _duration.Record(elapsed, tags);
        if (decision is not null)
        {
            _decisions.Add(
                1,
                new TagList { { "ctlflow.decision", decision } });
            activity?.SetTag("ctlflow.decision", decision);
        }
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetStatus(
            outcome == "OK"
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        var previous = Activity.Current;
        try
        {
            Activity.Current = activity;
            LogCompletion(
                _logger,
                "CheckAccess",
                outcome,
                elapsed,
                null);
        }
        finally
        {
            Activity.Current = previous;
        }
    }

    internal Activity? StartIdentityCall(string method)
    {
        var activity = _activities.StartActivity(
            $"policyd.identityd.{method}",
            ActivityKind.Client);
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag(
            "rpc.service",
            "ctlflow.identity.v1.IdentityService");
        activity?.SetTag("rpc.method", method);
        return activity;
    }

    internal static void AddTraceContext(
        Metadata headers,
        Activity? activity)
    {
        if (activity is null)
        {
            return;
        }
        var flags = ((byte)activity.ActivityTraceFlags).ToString(
            "x2",
            CultureInfo.InvariantCulture);
        headers.Add(
            "traceparent",
            $"00-{activity.TraceId}-{activity.SpanId}-{flags}");
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }

    public void Dispose()
    {
        _metrics.Dispose();
        _traces.Dispose();
        _meter.Dispose();
        _activities.Dispose();
    }

    internal static ResourceBuilder CreateResource() =>
        ResourceBuilder.CreateEmpty().AddService(
            serviceName: "policyd",
            serviceNamespace: "ctlflow",
            serviceVersion: typeof(PolicydTelemetry).Assembly
                .GetName().Version?.ToString() ?? "0.0.0");

    private static ActivityContext ReadParentContext(Metadata headers)
    {
        var traceParent = ReadSingleHeader(headers, "traceparent", 128);
        var traceState = ReadSingleHeader(headers, "tracestate", 512);
        return traceParent is not null
            && ActivityContext.TryParse(
                traceParent,
                traceState,
                true,
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
            if (header.IsBinary || value is not null
                || header.Value.Length > maximumLength)
            {
                return null;
            }
            value = header.Value;
        }
        return value;
    }
}
