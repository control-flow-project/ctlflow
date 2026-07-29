using CtlFlow.Edge.Edged.Domain.Bindings;
using CtlFlow.Edge.Edged.Service.Configuration;
using CtlFlow.Edge.Edged.Service.Telemetry;
using CtlFlow.Identity.V1;
using Google.Protobuf;
using Grpc.Core;

namespace CtlFlow.Edge.Edged.Service.Identity;

internal static partial class SessionExchange
{
    internal static async Task<InvocationCredential> ExchangeSession(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        EdgedTelemetry telemetry,
        SessionCredential credential,
        ExposureTarget target,
        CancellationToken cancellation)
    {
        var request = new ExchangeSessionRequest
        {
            SessionCredential = ByteString.CopyFrom(
                credential.ReadForIdentityExchange()),
            TenantId = target switch
            {
                ExposureTarget.Tenant tenant =>
                    tenant.TenantId.Value,
                ExposureTarget.Workspace workspaceTarget =>
                    workspaceTarget.TenantId.Value,
                _ => throw new InvalidOperationException(
                    "Exposure target is invalid")
            }
        };
        if (target is ExposureTarget.Workspace workspaceScope)
        {
            request.WorkspaceId = workspaceScope.WorkspaceId.Value;
        }

        var token = await ReadWorkloadToken(
            settings.WorkloadTokenFilePath,
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" }
        };
        using var timeout =
            CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(settings.CallTimeout);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartDependency(
            "edged.identity.exchange_session");
        EdgedTelemetry.InjectTraceContext(headers);
        var outcome = "unavailable";
        try
        {
            var response = await client.ExchangeSessionAsync(
                request,
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                timeout.Token);
            var now = DateTimeOffset.UtcNow;
            if (response.ExpiresAt is null
                || response.InvocationJwt.Length is < 1 or > 16_384)
            {
                throw new InvalidDataException(
                    "Identityd returned an invalid invocation");
            }

            var expiresAt = response.ExpiresAt.ToDateTimeOffset();
            if (expiresAt <= now || expiresAt > now.AddSeconds(60))
            {
                throw new InvalidDataException(
                    "Identityd returned an invalid invocation");
            }

            outcome = "ok";
            return new InvocationCredential(
                response.InvocationJwt,
                expiresAt);
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "cancelled";
            throw;
        }
        catch (RpcException exception) when (
            exception.StatusCode is StatusCode.Unauthenticated
                or StatusCode.NotFound)
        {
            outcome = "rejected";
            throw new SessionRejectedException();
        }
        catch (Exception exception) when (
            exception is RpcException
                or OperationCanceledException
                or InvalidDataException
                or IOException)
        {
            throw new IdentityUnavailableException(exception);
        }
        finally
        {
            telemetry.RecordDependency(
                activity,
                outcome,
                started);
        }
    }
}
