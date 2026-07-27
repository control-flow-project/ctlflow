using System.Diagnostics;
using System.Diagnostics.Metrics;
using CtlFlow.Auth.Authd.Service.Admission;
using CtlFlow.Auth.Authd.Service.State;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CtlFlow.Auth.Authd.Service.Telemetry;

internal sealed class AuthdTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.authd";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<
        ILogger,
        string,
        string,
        int,
        double,
        Exception?> LogHttpCompletion =
        LoggerMessage.Define<string, string, int, double>(
            LogLevel.Information,
            new EventId(1, "AuthdHttpCompleted"),
            "{Operation} completed with {Outcome} status {StatusCode} "
            + "in {DurationMilliseconds} ms");
    private static readonly Action<
        ILogger,
        string,
        string,
        string,
        double,
        Exception?> LogDependencyCompletion =
        LoggerMessage.Define<string, string, string, double>(
            LogLevel.Information,
            new EventId(2, "AuthdDependencyCompleted"),
            "{Operation} dependency {Dependency} completed with {Outcome} "
            + "in {DurationMilliseconds} ms");

    private readonly ActivitySource _activities = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<AuthdTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Histogram<double> _duration;
    private readonly Counter<long> _dependencyRequests;
    private readonly Histogram<double> _dependencyDuration;
    private readonly Counter<long> _admissionRejections;
    private readonly ObservableGauge<int> _publicInFlight;
    private readonly ObservableGauge<int> _callbacksInFlight;
    private readonly ObservableGauge<int> _attemptsInFlight;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal AuthdTelemetry(
        TelemetrySettings settings,
        ILogger<AuthdTelemetry> logger,
        PublicAdmission admission,
        AuthenticationAttemptStore attempts)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.authd.http.requests",
            description: "Completed Authd browser requests");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.authd.http.duration",
            unit: "ms",
            description: "Authd browser request duration");
        _dependencyRequests = _meter.CreateCounter<long>(
            "ctlflow.authd.dependency.requests",
            description: "Completed Authd dependency calls");
        _dependencyDuration = _meter.CreateHistogram<double>(
            "ctlflow.authd.dependency.duration",
            unit: "ms",
            description: "Authd dependency call duration");
        _admissionRejections = _meter.CreateCounter<long>(
            "ctlflow.authd.admission.rejections",
            description: "Rejected bounded admission");
        _publicInFlight = _meter.CreateObservableGauge(
            "ctlflow.authd.public.in_flight",
            () => admission.PublicInFlight,
            description: "Admitted public requests in flight");
        _callbacksInFlight = _meter.CreateObservableGauge(
            "ctlflow.authd.callbacks.in_flight",
            () => admission.CallbacksInFlight,
            description: "Consumed callbacks in flight");
        _attemptsInFlight = _meter.CreateObservableGauge(
            "ctlflow.authd.attempts.in_flight",
            () => attempts.Count,
            description: "Live authentication attempts");

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
                    .ExportTimeoutMilliseconds =
                        ExportTimeoutMilliseconds;
            })
            .Build();
    }

    internal Activity? StartHttpOperation(
        string operation,
        HttpRequest request)
    {
        var parent = TraceContexts.ReadHttpParent(request);
        var activity = _activities.StartActivity(
            operation,
            ActivityKind.Server,
            parent);
        activity?.SetTag("http.request.method", request.Method);
        activity?.SetTag(
            "http.route",
            operation switch
            {
                "authd.http.begin" => "/auth/v1/begin",
                "authd.http.callback" => "/auth/v1/callback",
                "authd.http.logout" => "/auth/v1/logout",
                _ => "unknown"
            });
        return activity;
    }

    internal void RecordHttpOperation(
        Activity? activity,
        string operation,
        string method,
        int statusCode,
        string outcome,
        string dependency,
        long startedTimestamp)
    {
        var milliseconds =
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;
        var tags = new TagList
        {
            { "ctlflow.operation", operation },
            { "http.request.method", method },
            { "http.response.status_code", statusCode },
            { "ctlflow.outcome", outcome },
            { "ctlflow.dependency", dependency }
        };
        _requests.Add(1, tags);
        _duration.Record(milliseconds, tags);
        activity?.SetTag("http.response.status_code", statusCode);
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetTag("ctlflow.dependency", dependency);
        activity?.SetStatus(
            statusCode < 400
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        WithCurrent(activity, () => LogHttpCompletion(
            _logger,
            operation,
            outcome,
            statusCode,
            milliseconds,
            null));
    }

    internal Activity? StartDependency(
        string operation,
        string dependency)
    {
        var activity = _activities.StartActivity(
            operation,
            ActivityKind.Client);
        activity?.SetTag("ctlflow.dependency", dependency);
        return activity;
    }

    internal void RecordDependency(
        Activity? activity,
        string operation,
        string dependency,
        string outcome,
        long startedTimestamp)
    {
        var milliseconds =
            Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;
        var tags = new TagList
        {
            { "ctlflow.operation", operation },
            { "ctlflow.dependency", dependency },
            { "ctlflow.outcome", outcome }
        };
        _dependencyRequests.Add(1, tags);
        _dependencyDuration.Record(milliseconds, tags);
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetStatus(
            outcome == "ok" || outcome == "already_logged_out"
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
        WithCurrent(activity, () => LogDependencyCompletion(
            _logger,
            operation,
            dependency,
            outcome,
            milliseconds,
            null));
    }

    internal void RecordAdmissionRejection(string reason) =>
        _admissionRejections.Add(
            1,
            new TagList { { "ctlflow.reason", reason } });

    public void Dispose()
    {
        _metrics.Dispose();
        _traces.Dispose();
        _meter.Dispose();
        _activities.Dispose();
    }

    internal static ResourceBuilder CreateResource() =>
        ResourceBuilder.CreateEmpty()
            .AddService(
                serviceName: "authd",
                serviceNamespace: "ctlflow",
                serviceVersion: typeof(AuthdTelemetry).Assembly
                    .GetName()
                    .Version?
                    .ToString() ?? "0.0.0");

    private static void WithCurrent(
        Activity? activity,
        Action action)
    {
        var previous = Activity.Current;
        try
        {
            Activity.Current = activity;
            action();
        }
        finally
        {
            Activity.Current = previous;
        }
    }
}
