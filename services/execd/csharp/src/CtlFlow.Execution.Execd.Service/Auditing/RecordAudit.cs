using CtlFlow.Audit.V1;
using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Execution.Execd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static async Task RecordAudit(
        AuditService.AuditServiceClient auditClient,
        AuditSettings settings,
        ExecdTelemetry telemetry,
        AuditIntent intent,
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
                    != intent.EventId.Value)
            {
                throw new InvalidOperationException(
                    "auditd returned an invalid acceptance");
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
}
