using CtlFlow.Audit.V1;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Telemetry;
using Grpc.Core;
using System.Globalization;
using static CtlFlow.Configuration.Configd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Configuration.Configd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static async Task RecordAudit(
        AuditService.AuditServiceClient auditClient,
        AuditSettings settings,
        ConfigdTelemetry telemetry,
        ConfigdAuditIntent intent,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var token = (await File.ReadAllTextAsync(
            settings.WorkloadTokenFilePath,
            cancellation)).Trim();
        if (token.Length is < 1 or > 16_384)
        {
            throw new AuditUnavailableException(
                new InvalidDataException(
                    "Audit workload token is invalid"));
        }

        var request = await CreateRecordAuditBatchRequest(
            intent,
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" }
        };
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartAuditDelivery();
        AddTraceContext(headers, activity);
        var outcome = "UNAVAILABLE";
        try
        {
            var response = await auditClient.RecordAuditBatchAsync(
                request,
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            if (response.Acceptances.Count != 1
                || response.Acceptances[0].SourceEventId
                    != intent.Envelope.EventId.Value)
            {
                throw new InvalidOperationException(
                    "Auditd returned an invalid acceptance");
            }

            outcome = "OK";
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "CANCELLED";
            throw;
        }
        catch (RpcException exception)
        {
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw new AuditUnavailableException(exception);
        }
        catch (Exception exception)
        {
            throw new AuditUnavailableException(exception);
        }
        finally
        {
            telemetry.RecordAuditDelivery(activity, outcome, started);
        }
    }

    private static void AddTraceContext(
        Metadata headers,
        System.Diagnostics.Activity? activity)
    {
        if (activity is null)
        {
            return;
        }

        headers.Add(
            "traceparent",
            $"00-{activity.TraceId}-{activity.SpanId}-"
            + ((byte)activity.ActivityTraceFlags).ToString(
                "x2",
                CultureInfo.InvariantCulture));
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }
}
