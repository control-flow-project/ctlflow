using System.Diagnostics;
using System.Diagnostics.Metrics;
using Grpc.Core;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CtlFlow.Configuration.Configd.Service.Telemetry;

internal sealed class ConfigdTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.configd";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<ILogger, string, string, double, Exception?>
        LogOperationCompletion = LoggerMessage.Define<string, string, double>(
            LogLevel.Information,
            new EventId(1, "ConfigdOperationCompleted"),
            "{Operation} completed with {Outcome} in {DurationMilliseconds} ms");
    private readonly ActivitySource _activitySource = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<ConfigdTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Histogram<double> _duration;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal ConfigdTelemetry(
        TelemetrySettings settings,
        ILogger<ConfigdTelemetry> logger)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.configd.requests",
            description: "Completed configd operations");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.configd.duration",
            unit: "ms",
            description: "Configd operation duration");

        _traces = Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .SetSampler(new AlwaysOnSampler())
            .AddSource(SourceName)
            .AddSource(CtlFlow.Configuration.Configd.Db.ConfigurationDbTelemetry.SourceName)
            .AddSource(
                CtlFlow.Configuration.Configd.Db.Custody
                    .ConfigurationCryptoTelemetry.SourceName)
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

    internal Activity? StartGrpcOperation(
        string method,
        Metadata headers)
    {
        var parent = ReadParentContext(headers);
        var activity = _activitySource.StartActivity(
            $"configd.{method}",
            ActivityKind.Server,
            parent);
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag("rpc.service", "ctlflow.configuration.v1.ConfigurationService");
        activity?.SetTag("rpc.method", method);
        return activity;
    }

    internal void RecordGrpcOperation(
        Activity? activity,
        string operation,
        string outcome,
        long startedTimestamp)
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
            outcome == "OK"
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        var previousActivity = Activity.Current;
        try
        {
            Activity.Current = activity;
            LogOperationCompletion(
                _logger,
                operation,
                outcome,
                durationMilliseconds,
                null);
        }
        finally
        {
            Activity.Current = previousActivity;
        }
    }

    internal Activity? StartHttpOperation(
        string operation,
        string method,
        IHeaderDictionary headers)
    {
        var parent = ReadParentContext(headers);
        var activity = _activitySource.StartActivity(
            $"configd.{operation}",
            ActivityKind.Server,
            parent);
        activity?.SetTag("http.request.method", method);
        activity?.SetTag("ctlflow.operation", operation);
        return activity;
    }

    internal void RecordHttpOperation(
        Activity? activity,
        string operation,
        string outcome,
        long startedTimestamp) =>
        RecordGrpcOperation(
            activity,
            operation,
            outcome,
            startedTimestamp);

    internal Activity? StartAuditDelivery()
    {
        var activity = _activitySource.StartActivity(
            "configd.RecordAuditBatch",
            ActivityKind.Client);
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag("rpc.service", "ctlflow.audit.v1.AuditService");
        activity?.SetTag("rpc.method", "RecordAuditBatch");
        return activity;
    }

    internal void RecordAuditDelivery(
        Activity? activity,
        string outcome,
        long startedTimestamp) =>
        RecordGrpcOperation(
            activity,
            "RecordAuditBatch",
            outcome,
            startedTimestamp);

    internal Activity? StartPolicyCheck()
    {
        var activity = _activitySource.StartActivity(
            "configd.CheckAccess",
            ActivityKind.Client);
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag("rpc.service", "ctlflow.policy.v1.PolicyService");
        activity?.SetTag("rpc.method", "CheckAccess");
        return activity;
    }

    internal void RecordPolicyCheck(
        Activity? activity,
        string outcome,
        string? decision,
        long startedTimestamp) =>
        RecordPolicyCheckCore(
            activity,
            outcome,
            decision,
            startedTimestamp);

    internal Activity? StartKubernetesOperation(string operation)
    {
        var activity = _activitySource.StartActivity(
            $"configd.kubernetes.{operation}",
            ActivityKind.Client);
        activity?.SetTag("server.address", "kubernetes");
        activity?.SetTag("ctlflow.operation", operation);
        return activity;
    }

    internal void RecordKubernetesOperation(
        Activity? activity,
        string operation,
        string outcome,
        long startedTimestamp) =>
        RecordGrpcOperation(
            activity,
            $"kubernetes.{operation}",
            outcome,
            startedTimestamp);

    private void RecordPolicyCheckCore(
        Activity? activity,
        string outcome,
        string? decision,
        long startedTimestamp)
    {
        if (decision is not null)
        {
            activity?.SetTag("ctlflow.decision", decision);
        }

        RecordGrpcOperation(
            activity,
            "CheckAccess",
            outcome,
            startedTimestamp);
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
                serviceName: "configd",
                serviceNamespace: "ctlflow",
                serviceVersion: typeof(ConfigdTelemetry).Assembly
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
