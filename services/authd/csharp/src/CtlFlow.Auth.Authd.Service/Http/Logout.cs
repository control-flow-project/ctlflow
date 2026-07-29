using CtlFlow.Auth.Authd.Domain.Browser;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Identity;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Microsoft.Net.Http.Headers;
using static CtlFlow.Auth.Authd.Service.Http.BrowserRequests;
using static CtlFlow.Auth.Authd.Service.Http.FormEncoding;
using static CtlFlow.Auth.Authd.Service.Http.HttpResponses;
using static CtlFlow.Auth.Authd.Service.Identity.IdentityCalls;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class BrowserRoutes
{
    internal static async Task Logout(
        HttpContext context,
        AuthdSettings settings,
        IdentityService.IdentityServiceClient identityClient,
        AuthdTelemetry telemetry)
    {
        const string operation = "authd.http.logout";
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
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var status = StatusCodes.Status500InternalServerError;
        var outcome = "internal";
        var dependency = "none";
        try
        {
            ValidateBrowserPost(
                context.Request,
                settings.Projection);
            var fields = await ReadForm(
                context.Request,
                maximumFields: 1,
                optional: true,
                timeout.Token);
            ReturnTarget returnTarget;
            try
            {
                returnTarget = fields.Remove(
                        "return_to",
                        out var returnValue)
                    ? ReturnTarget.Parse(returnValue)
                    : ReturnTarget.Default;
            }
            catch (ArgumentException)
            {
                throw InvalidLogout();
            }
            if (fields.Count != 0)
            {
                throw InvalidLogout();
            }

            var stateCookie = BrowserCookies.Read(
                context.Request,
                BrowserCookies.StateName);
            if (stateCookie.State == CookieReadState.Invalid)
            {
                throw InvalidLogout();
            }
            var sessionCookie = BrowserCookies.Read(
                context.Request,
                BrowserCookies.SessionName);
            if (sessionCookie.State == CookieReadState.Valid)
            {
                using var credential = SessionCredential.ParseCookie(
                    sessionCookie.Value!);
                if (credential is not null)
                {
                    dependency = "identityd";
                    await RevokeSession(
                        identityClient,
                        settings.Identity,
                        settings.Workload,
                        telemetry,
                        credential,
                        timeout.Token);
                }
            }

            context.Response.Headers.Append(
                HeaderNames.SetCookie,
                BrowserCookies.ClearSessionCookie);
            context.Response.Headers.Append(
                HeaderNames.SetCookie,
                BrowserCookies.ClearStateCookie);
            WriteRedirect(context.Response, returnTarget.Value);
            status = StatusCodes.Status303SeeOther;
            outcome = "logged_out";
            dependency = "none";
        }
        catch (Exception exception)
        {
            (status, outcome, dependency) =
                MapLogoutFailure(exception, dependency);
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
                    retryAfterSeconds:
                        status == StatusCodes.Status429TooManyRequests
                            ? 1
                            : null);
            }
        }
        finally
        {
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
        string Dependency) MapLogoutFailure(
            Exception exception,
            string currentDependency) =>
        exception switch
        {
            HttpContractException contract =>
                (contract.StatusCode, contract.Outcome, "none"),
            DependencyUnavailableException unavailable =>
                (StatusCodes.Status503ServiceUnavailable,
                    "dependency_unavailable",
                    unavailable.Dependency),
            OperationCanceledException =>
                (StatusCodes.Status503ServiceUnavailable,
                    "deadline",
                    currentDependency),
            _ => (StatusCodes.Status500InternalServerError,
                "internal",
                currentDependency)
        };

    private static HttpContractException InvalidLogout() =>
        new(StatusCodes.Status400BadRequest, "invalid_request");
}
