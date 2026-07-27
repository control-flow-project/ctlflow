using System.Diagnostics;
using System.Diagnostics.Metrics;
using CtlFlow.Audit.Auditd.Db;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Sources;
using Grpc.Core;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using static CtlFlow.Audit.Auditd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Audit.Auditd.Service.Telemetry;

internal sealed class AuditdTelemetry : IDisposable
{
    internal const string SourceName = "ctlflow.auditd";
    private const int ExportTimeoutMilliseconds = 1_000;
    private static readonly Action<ILogger, string, string, double, Exception?>
        LogOperationCompletion = LoggerMessage.Define<string, string, double>(
            LogLevel.Information,
            new EventId(1, "AuditdOperationCompleted"),
            "{Operation} completed with {Outcome} in {DurationMilliseconds} ms");
    private readonly ActivitySource _activitySource = new(SourceName);
    private readonly Meter _meter = new(SourceName);
    private readonly ILogger<AuditdTelemetry> _logger;
    private readonly Counter<long> _requests;
    private readonly Histogram<double> _duration;
    private readonly Histogram<long> _batchSize;
    private readonly Counter<long> _acceptedEvents;
    private readonly Counter<long> _newEvents;
    private readonly Counter<long> _replays;
    private readonly TracerProvider _traces;
    private readonly MeterProvider _metrics;

    internal AuditdTelemetry(
        TelemetrySettings settings,
        ILogger<AuditdTelemetry> logger)
    {
        _logger = logger;
        _requests = _meter.CreateCounter<long>(
            "ctlflow.auditd.requests",
            description: "Completed auditd operations");
        _duration = _meter.CreateHistogram<double>(
            "ctlflow.auditd.duration",
            unit: "ms",
            description: "auditd operation duration");
        _batchSize = _meter.CreateHistogram<long>(
            "ctlflow.auditd.batch.size",
            unit: "{event}",
            description: "Accepted audit batch size");
        _acceptedEvents = _meter.CreateCounter<long>(
            "ctlflow.auditd.events.accepted",
            description: "Accepted audit events by finite contract kind");
        _newEvents = _meter.CreateCounter<long>(
            "ctlflow.auditd.events.new",
            description: "Newly persisted audit events");
        _replays = _meter.CreateCounter<long>(
            "ctlflow.auditd.events.replayed",
            description: "Idempotently replayed audit events");

        _traces = Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(CreateResource())
            .SetSampler(new AlwaysOnSampler())
            .AddSource(SourceName)
            .AddSource(AuditDbTelemetry.SourceName)
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

    internal Activity? StartGrpcOperation(string method, Metadata headers)
    {
        var activity = _activitySource.StartActivity(
            $"auditd.{method}",
            ActivityKind.Server,
            ReadParentContext(headers));
        activity?.SetTag("rpc.system", "grpc");
        activity?.SetTag(
            "rpc.service",
            "ctlflow.audit.v1.AuditService");
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
        var previous = Activity.Current;
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
            Activity.Current = previous;
        }
    }

    internal void RecordAcceptedBatch(
        AuditSource source,
        IReadOnlyList<AuditRecord> records,
        AuditBatchResult result)
    {
        _batchSize.Record(records.Count);
        _newEvents.Add(result.NewEventCount);
        _replays.Add(result.ReplayCount);
        foreach (var record in records)
        {
            var tags = new TagList
            {
                { "ctlflow.audit.source", SourceNameFor(source) },
                { "ctlflow.audit.detail", DetailName(record.DetailKind) },
                {
                    "ctlflow.audit.partition",
                    record.PartitionKind == AuditPartitionKind.Global
                        ? "global"
                        : "tenant"
                }
            };
            _acceptedEvents.Add(1, tags);
        }
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
                serviceName: "auditd",
                serviceNamespace: "ctlflow",
                serviceVersion: typeof(AuditdTelemetry).Assembly
                    .GetName()
                    .Version?
                    .ToString() ?? "0.0.0");

    private static string SourceNameFor(AuditSource source) =>
        source switch
        {
            AuditSource.Tenantd => "tenantd",
            AuditSource.Identityd => "identityd",
            AuditSource.Pkgd => "pkgd",
            AuditSource.Configd => "configd",
            AuditSource.Execd => "execd",
            _ => "unknown"
        };

    private static string DetailName(AuditDetailKind kind) =>
        kind switch
        {
            AuditDetailKind.TenantMutation => "tenant_mutation",
            AuditDetailKind.WorkspaceMutation => "workspace_mutation",
            AuditDetailKind.IdentitySession => "identity_session",
            AuditDetailKind.PackageDeclaration => "package_declaration",
            AuditDetailKind.AppMutation => "app_mutation",
            AuditDetailKind.ConfigurationPublication =>
                "configuration_publication",
            AuditDetailKind.SecretPublication => "secret_publication",
            AuditDetailKind.ProjectionMutation => "projection_mutation",
            AuditDetailKind.PlacementMutation => "placement_mutation",
            AuditDetailKind.WorkloadMutation => "workload_mutation",
            AuditDetailKind.RunMutation => "run_mutation",
            _ => "unknown"
        };
}
