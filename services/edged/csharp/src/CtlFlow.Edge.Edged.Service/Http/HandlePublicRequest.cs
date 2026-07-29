using CtlFlow.Edge.Edged.Service.Admission;
using CtlFlow.Edge.Edged.Service.Configuration;
using CtlFlow.Edge.Edged.Service.Identity;
using CtlFlow.Edge.Edged.Service.Proxy;
using CtlFlow.Edge.Edged.Service.Telemetry;
using CtlFlow.Identity.V1;
using static CtlFlow.Edge.Edged.Service.Identity.SessionExchange;
using static CtlFlow.Edge.Edged.Service.Proxy.ApplicationProxy;

namespace CtlFlow.Edge.Edged.Service.Http;

internal static partial class PublicBoundary
{
    private const int MaximumTargetBytes = 16 * 1024;
    private const int MaximumHeaderBytes = 32 * 1024;
    private const int MaximumCookieBytes = 8 * 1024;
    private const long MaximumBodyBytes = 64L * 1024 * 1024;
    private const string AdmittedMethods =
        "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
    private static readonly IReadOnlySet<string> Methods =
        new HashSet<string>(
            [
                HttpMethods.Get,
                HttpMethods.Head,
                HttpMethods.Post,
                HttpMethods.Put,
                HttpMethods.Patch,
                HttpMethods.Delete,
                HttpMethods.Options
            ],
            StringComparer.Ordinal);

    internal static async Task HandlePublicRequest(
        HttpContext context,
        ServiceSettings settings,
        PublicAdmission admission,
        IdentityService.IdentityServiceClient identity,
        HttpClient application,
        EdgedTelemetry telemetry)
    {
        if (!Methods.Contains(context.Request.Method))
        {
            context.Response.Headers.Allow = AdmittedMethods;
            await WriteBoundaryError(
                context,
                StatusCodes.Status405MethodNotAllowed,
                "Method not allowed",
                context.RequestAborted);
            return;
        }

        var operation =
            $"edged.http.{context.Request.Method.ToLowerInvariant()}";
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartHttpOperation(
            operation,
            context.Request.Method,
            context.Request.Headers);
        var outcome = "internal_error";
        try
        {
            if (CalculateTargetBytes(context.Request)
                > MaximumTargetBytes)
            {
                outcome = "target_too_large";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status414UriTooLong,
                    "Request target too large",
                    context.RequestAborted);
                return;
            }
            if (CalculateHeaderBytes(context.Request.Headers)
                > MaximumHeaderBytes)
            {
                outcome = "headers_too_large";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status431RequestHeaderFieldsTooLarge,
                    "Request headers too large",
                    context.RequestAborted);
                return;
            }
            if (CalculateCookieBytes(context.Request.Headers)
                > MaximumCookieBytes)
            {
                outcome = "cookies_too_large";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status431RequestHeaderFieldsTooLarge,
                    "Request cookies too large",
                    context.RequestAborted);
                return;
            }
            if (context.Request.ContentLength > MaximumBodyBytes)
            {
                outcome = "request_body_too_large";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status413PayloadTooLarge,
                    "Request body too large",
                    context.RequestAborted);
                return;
            }
            if (!admission.TryAcquire())
            {
                outcome = "capacity_exhausted";
                context.Response.Headers.RetryAfter = "1";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status429TooManyRequests,
                    "Capacity exhausted",
                    context.RequestAborted);
                return;
            }

            try
            {
                outcome = await ProxyApplicationRequest(
                    context,
                    settings,
                    identity,
                    application,
                    telemetry);
            }
            finally
            {
                admission.Release();
            }
        }
        catch (OperationCanceledException) when (
            context.RequestAborted.IsCancellationRequested)
        {
            outcome = "cancelled";
        }
        catch (Exception)
        {
            outcome = "boundary_failure";
            await WriteBoundaryError(
                context,
                StatusCodes.Status502BadGateway,
                "Bad gateway",
                context.RequestAborted);
        }
        finally
        {
            telemetry.RecordHttpOperation(
                activity,
                operation,
                outcome,
                context.Response.StatusCode,
                started);
        }
    }

    private static async Task<string> ProxyApplicationRequest(
        HttpContext context,
        ServiceSettings settings,
        IdentityService.IdentityServiceClient identity,
        HttpClient application,
        EdgedTelemetry telemetry)
    {
        using var cookies = ExtractSessionCookie(
            context.Request.Headers);
        if (cookies is null)
        {
            await WriteBoundaryError(
                context,
                StatusCodes.Status401Unauthorized,
                "Unauthorized",
                context.RequestAborted);
            return "unauthorized";
        }

        InvocationCredential invocation;
        try
        {
            invocation = await ExchangeSession(
                identity,
                settings.Identity,
                telemetry,
                cookies.Credential,
                settings.Binding.Target,
                context.RequestAborted);
        }
        catch (SessionRejectedException)
        {
            await WriteBoundaryError(
                context,
                StatusCodes.Status401Unauthorized,
                "Unauthorized",
                context.RequestAborted);
            return "unauthorized";
        }
        catch (IdentityUnavailableException)
        {
            await WriteBoundaryError(
                context,
                StatusCodes.Status503ServiceUnavailable,
                "Service unavailable",
                context.RequestAborted);
            return "identity_unavailable";
        }

        using var outgoing = CreateApplicationRequest(
            context,
            settings.Proxy.ApplicationOrigin,
            invocation,
            cookies.ApplicationCookie,
            MaximumBodyBytes);
        using var timeout =
            CancellationTokenSource.CreateLinkedTokenSource(
                context.RequestAborted);
        timeout.CancelAfter(settings.Proxy.ApplicationTimeout);
        var dependencyStarted =
            System.Diagnostics.Stopwatch.GetTimestamp();
        using var dependencyActivity = telemetry.StartDependency(
            "edged.application");
        HttpResponseMessage? response = null;
        var dependencyOutcome = "unavailable";
        try
        {
            EdgedTelemetry.InjectTraceContext(outgoing);
            response = await application.SendAsync(
                outgoing,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            if (outgoing.Content is BoundedRequestContent bounded)
            {
                await bounded.Completion.WaitAsync(timeout.Token);
                if (bounded.ExceededMaximum)
                {
                    throw new RequestBodyTooLargeException();
                }
            }
            dependencyOutcome = "ok";
            await CopyApplicationResponse(
                context,
                response,
                MaximumBodyBytes,
                timeout.Token);
            return "ok";
        }
        catch (Exception exception) when (
            Contains<RequestBodyTooLargeException>(exception))
        {
            dependencyOutcome = "request_body_too_large";
            await WriteBoundaryError(
                context,
                StatusCodes.Status413PayloadTooLarge,
                "Request body too large",
                CancellationToken.None);
            return dependencyOutcome;
        }
        catch (ResponseBodyTooLargeException)
        {
            dependencyOutcome = "response_body_too_large";
            if (context.Response.HasStarted)
            {
                context.Abort();
            }
            else
            {
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status502BadGateway,
                    "Bad gateway",
                    context.RequestAborted);
            }
            return dependencyOutcome;
        }
        catch (OperationCanceledException) when (
            !context.RequestAborted.IsCancellationRequested)
        {
            dependencyOutcome = "deadline_exceeded";
            await WriteBoundaryError(
                context,
                StatusCodes.Status504GatewayTimeout,
                "Gateway timeout",
                context.RequestAborted);
            return dependencyOutcome;
        }
        catch (Exception exception) when (
            exception is HttpRequestException or IOException)
        {
            dependencyOutcome = "application_unavailable";
            await WriteBoundaryError(
                context,
                StatusCodes.Status502BadGateway,
                "Bad gateway",
                context.RequestAborted);
            return dependencyOutcome;
        }
        catch (Exception)
        {
            dependencyOutcome = "application_failure";
            await WriteBoundaryError(
                context,
                StatusCodes.Status502BadGateway,
                "Bad gateway",
                context.RequestAborted);
            return dependencyOutcome;
        }
        finally
        {
            response?.Dispose();
            telemetry.RecordDependency(
                dependencyActivity,
                dependencyOutcome,
                dependencyStarted);
        }
    }

    private static bool Contains<T>(Exception exception)
        where T : Exception
    {
        for (Exception? current = exception;
             current is not null;
             current = current.InnerException)
        {
            if (current is T)
            {
                return true;
            }
        }

        return false;
    }
}
