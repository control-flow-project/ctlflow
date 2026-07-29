using CtlFlow.Auth.Authd.Domain.State;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Identity;
using CtlFlow.Auth.Authd.Service.Oidc;
using CtlFlow.Auth.Authd.Service.State;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Microsoft.Net.Http.Headers;
using static CtlFlow.Auth.Authd.Service.Http.CallbackQueries;
using static CtlFlow.Auth.Authd.Service.Http.HttpResponses;
using static CtlFlow.Auth.Authd.Service.Identity.IdentityCalls;
using static CtlFlow.Auth.Authd.Service.Oidc.OidcProtocol;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class BrowserRoutes
{
    internal static async Task CompleteProviderCallback(
        HttpContext context,
        AuthdSettings settings,
        AuthenticationAttemptStore attempts,
        HttpClient egressClient,
        IdentityService.IdentityServiceClient identityClient,
        AuthdTelemetry telemetry)
    {
        const string operation = "authd.http.callback";
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartHttpOperation(
            operation,
            context.Request);
        var stopping = context.RequestServices
            .GetRequiredService<IHostApplicationLifetime>()
            .ApplicationStopping;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted,
            stopping);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        AuthenticationAttempt? attempt = null;
        var consumed = false;
        var status = StatusCodes.Status500InternalServerError;
        var outcome = "internal";
        var dependency = "none";
        try
        {
            var query = ParseCallbackQuery(context.Request);
            var stateCookie = BrowserCookies.Read(
                context.Request,
                BrowserCookies.StateName);
            if (stateCookie.State != CookieReadState.Valid)
            {
                throw InvalidCallback();
            }
            attempt = attempts.Consume(
                query.State,
                stateCookie.Value!,
                DateTimeOffset.UtcNow);
            if (attempt is null)
            {
                throw InvalidCallback();
            }
            consumed = true;

            if (query.Error is not null)
            {
                throw new OidcRejectedException();
            }
            var provider = settings.Projection.Find(
                attempt.TenantId,
                attempt.ProviderId)
                ?? throw new DependencyUnavailableException("projection");
            dependency = "egressd";
            var subject = await CompleteOidcAuthentication(
                egressClient,
                telemetry,
                settings.Workload,
                provider,
                settings.Projection.CallbackUri,
                attempt,
                query.Code!,
                timeout.Token);
            dependency = "identityd";
            using var session = await CreateSession(
                identityClient,
                settings.Identity,
                settings.Workload,
                telemetry,
                attempt,
                subject,
                timeout.Token);
            var sessionCookie = BrowserCookies.CreateSessionCookie(
                session.Credential.EncodeForCookie(),
                session.ExpiresAt,
                DateTimeOffset.UtcNow);
            context.Response.Headers.Append(
                HeaderNames.SetCookie,
                sessionCookie);
            context.Response.Headers.Append(
                HeaderNames.SetCookie,
                BrowserCookies.ClearStateCookie);
            WriteRedirect(
                context.Response,
                attempt.ReturnTarget.Value);
            status = StatusCodes.Status303SeeOther;
            outcome = "authenticated";
            dependency = "none";
        }
        catch (Exception exception)
        {
            (status, outcome, dependency) =
                MapCallbackFailure(exception, dependency);
            if (exception is OperationCanceledException
                && (context.RequestAborted.IsCancellationRequested
                    || stopping.IsCancellationRequested))
            {
                outcome = "cancelled";
            }
            if (!context.RequestAborted.IsCancellationRequested
                && !stopping.IsCancellationRequested)
            {
                await WriteError(
                    context.Response,
                    status,
                    context.RequestAborted,
                    clearStateCookie: consumed,
                    retryAfterSeconds:
                        status == StatusCodes.Status429TooManyRequests
                            ? 1
                            : null);
            }
        }
        finally
        {
            attempt?.Dispose();
            telemetry.RecordHttpOperation(
                activity,
                operation,
                context.Request.Method,
                status,
                outcome,
                dependency,
                started);
        }
    }

    private static (
        int Status,
        string Outcome,
        string Dependency) MapCallbackFailure(
            Exception exception,
            string currentDependency) =>
        exception switch
        {
            HttpContractException contract =>
                (contract.StatusCode, contract.Outcome, "none"),
            OidcRejectedException =>
                (StatusCodes.Status401Unauthorized,
                    "authentication_rejected",
                    currentDependency),
            DependencyUnavailableException unavailable =>
                (StatusCodes.Status503ServiceUnavailable,
                    "dependency_unavailable",
                    unavailable.Dependency),
            InvalidDataException =>
                (StatusCodes.Status503ServiceUnavailable,
                    "dependency_unavailable",
                    currentDependency),
            OperationCanceledException =>
                (StatusCodes.Status503ServiceUnavailable,
                    "deadline",
                    currentDependency),
            _ => (StatusCodes.Status500InternalServerError,
                "internal",
                currentDependency)
        };

    private static HttpContractException InvalidCallback() =>
        new(StatusCodes.Status400BadRequest, "invalid_callback");
}
