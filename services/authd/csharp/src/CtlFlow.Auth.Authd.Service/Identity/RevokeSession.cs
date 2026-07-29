using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Security;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Google.Protobuf;
using Grpc.Core;
using static CtlFlow.Auth.Authd.Service.Security.WorkloadAuthentication;
using static CtlFlow.Auth.Authd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Auth.Authd.Service.Identity;

internal static partial class IdentityCalls
{
    internal static async Task RevokeSession(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        WorkloadSettings workload,
        AuthdTelemetry telemetry,
        SessionCredential credential,
        CancellationToken cancellation)
    {
        var bearer = await ReadWorkloadBearer(
            workload,
            "identityd",
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {bearer}" }
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var activity = telemetry.StartDependency(
            "authd.identity.revoke_session",
            "identityd");
        InjectGrpcTraceContext(headers, activity);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "unavailable";
        try
        {
            await client.RevokeSessionAsync(
                new RevokeSessionRequest
                {
                    SessionCredential = ByteString.CopyFrom(
                        credential.ReadForRevocation())
                },
                headers,
                DateTime.UtcNow.AddSeconds(3),
                timeout.Token);
            outcome = "ok";
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "cancelled";
            throw;
        }
        catch (RpcException exception) when (
            exception.StatusCode == StatusCode.Unauthenticated)
        {
            outcome = "already_logged_out";
        }
        catch (Exception exception) when (
            exception is RpcException
                or OperationCanceledException)
        {
            throw new DependencyUnavailableException(
                "identityd",
                exception);
        }
        finally
        {
            telemetry.RecordDependency(
                activity,
                "authd.identity.revoke_session",
                "identityd",
                outcome,
                started);
        }
    }
}
