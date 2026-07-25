using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static async Task<AuditDeliveryResult> DeliverAuditOutboxBatch(
        AuditService.AuditServiceClient client,
        AuditSettings settings,
        TenantdTelemetry telemetry,
        AuditOutboxLease lease,
        CancellationToken cancellation)
    {
        using var activity = telemetry.StartAuditDelivery();
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "transient_failure";
        try
        {
            var token = await ReadAuditWorkloadToken(
                settings.WorkloadTokenFile,
                cancellation);
            var headers = new Metadata
            {
                {
                    "authorization",
                    $"Bearer {token.ReadForAuthorization()}"
                }
            };
            if (activity is not null)
            {
                headers.Add(
                    "traceparent",
                    $"00-{activity.TraceId.ToHexString()}-"
                    + $"{activity.SpanId.ToHexString()}-01");
            }

            var response = await client.RecordAuditBatchAsync(
                CreateRecordAuditBatchRequest(lease),
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            if (!ValidateAuditAcceptances(lease, response))
            {
                outcome = "invalid_acceptance";
                return new AuditDeliveryResult.PermanentFailure(
                    AuditDeliveryFailureCode.InvalidAcceptance);
            }

            outcome = "ok";
            return new AuditDeliveryResult.Accepted();
        }
        catch (RpcException exception)
        {
            var permanent = MapPermanentFailure(exception.StatusCode);
            if (permanent is not null)
            {
                outcome = "permanent_failure";
                return new AuditDeliveryResult.PermanentFailure(
                    permanent.Value);
            }

            return new AuditDeliveryResult.TransientFailure();
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            return new AuditDeliveryResult.TransientFailure();
        }
        finally
        {
            telemetry.RecordAuditDelivery(activity, outcome, started);
        }
    }

    private static AuditDeliveryFailureCode? MapPermanentFailure(
        StatusCode status) =>
        status switch
        {
            StatusCode.AlreadyExists =>
                AuditDeliveryFailureCode.ConflictingReplay,
            StatusCode.InvalidArgument =>
                AuditDeliveryFailureCode.InvalidEnvelope,
            StatusCode.PermissionDenied =>
                AuditDeliveryFailureCode.SourceNotAdmitted,
            _ => null
        };
}
