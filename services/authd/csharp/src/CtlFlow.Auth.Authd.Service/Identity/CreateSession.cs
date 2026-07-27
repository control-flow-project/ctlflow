using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Domain.State;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Oidc;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Auth.Authd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Auth.Authd.Service.Identity;

internal static partial class IdentityCalls
{
    internal static async Task<CreatedSession> CreateSession(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        AuthdTelemetry telemetry,
        AuthenticationAttempt attempt,
        ProviderSubject subject,
        CancellationToken cancellation)
    {
        var bearer = await ReadWorkloadBearer(
            settings.WorkloadTokenPath,
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {bearer}" }
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var activity = telemetry.StartDependency(
            "authd.identity.create_session",
            "identityd");
        InjectGrpcTraceContext(headers, activity);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "unavailable";
        try
        {
            var response = await client.CreateSessionAsync(
                new CreateSessionRequest
                {
                    TenantId = attempt.TenantId.Value,
                    ProviderId = attempt.ProviderId.Value,
                    ProviderSubject = subject.Value
                },
                headers,
                DateTime.UtcNow.AddSeconds(3),
                timeout.Token);
            if (response.ExpiresAt is null)
            {
                throw new InvalidDataException(
                    "Identityd omitted Session expiry");
            }
            var expiresAt = response.ExpiresAt.ToDateTimeOffset();
            var credential = SessionCredential.FromIdentityd(
                response.SessionCredential.Span);
            outcome = "ok";
            return new CreatedSession(credential, expiresAt);
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
            outcome = "rejected";
            throw new OidcRejectedException();
        }
        catch (Exception exception) when (
            exception is RpcException
                or InvalidDataException
                or InvalidOperationException
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
                "authd.identity.create_session",
                "identityd",
                outcome,
                started);
        }
    }
}
