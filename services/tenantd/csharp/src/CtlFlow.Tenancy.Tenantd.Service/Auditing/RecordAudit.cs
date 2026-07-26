using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static async Task RecordAudit(
        AuditService.AuditServiceClient auditClient,
        AuditSettings settings,
        TenantdTelemetry telemetry,
        AuditIntent intent,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var token = (await File.ReadAllTextAsync(
            settings.WorkloadTokenFilePath,
            cancellation)).Trim();
        if (token.Length is < 1 or > 16_384)
        {
            throw new InvalidOperationException(
                "Audit workload token is invalid");
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

            telemetry.RecordAuditDelivery(activity, "ok", started);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            telemetry.RecordAuditDelivery(activity, "cancelled", started);
            throw;
        }
        catch (Exception exception)
        {
            telemetry.RecordAuditDelivery(activity, "unavailable", started);
            throw new AuditUnavailableException(exception);
        }
    }
}
