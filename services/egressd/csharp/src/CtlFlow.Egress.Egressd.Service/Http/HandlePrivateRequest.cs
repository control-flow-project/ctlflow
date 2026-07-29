using CtlFlow.Egress.Egressd.Domain.Rules;
using CtlFlow.Egress.Egressd.Service.Admission;
using CtlFlow.Egress.Egressd.Service.Configuration;
using CtlFlow.Egress.Egressd.Service.Proxy;
using CtlFlow.Egress.Egressd.Service.Security.Tokens;
using CtlFlow.Egress.Egressd.Service.Telemetry;
using static CtlFlow.Egress.Egressd.Domain.Rules.Rules;
using static CtlFlow.Egress.Egressd.Service.Proxy.EgressProxy;
using static CtlFlow.Egress.Egressd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Egress.Egressd.Service.Http;

internal static partial class PrivateBoundary
{
    private const int MaximumTargetBytes = 16 * 1024;
    private const int MaximumHeaderBytes = 32 * 1024;
    private const string AllMethods =
        "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";

    internal static async Task HandlePrivateRequest(
        HttpContext context,
        ServiceSettings settings,
        PrivateAdmission admission,
        HttpClient upstream,
        EgressdTelemetry telemetry)
    {
        var method = MapHttpMethod(context.Request.Method);
        if (method is null)
        {
            context.Response.Headers.Allow = AllMethods;
            await WriteBoundaryError(
                context,
                StatusCodes.Status405MethodNotAllowed,
                "Method not allowed",
                context.RequestAborted);
            return;
        }

        var operation =
            $"egressd.http.{context.Request.Method.ToLowerInvariant()}";
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartHttpOperation(
            operation,
            context.Request.Method,
            context.Request.Headers);
        var outcome = "internal_error";
        var ruleId = "none";
        var saturation = 0;
        try
        {
            if (CalculateTargetBytes(context.Request) > MaximumTargetBytes)
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

            try
            {
                await AuthenticateCaller(
                    context.Request.Headers,
                    settings.Configuration.Binding.Caller,
                    settings.WorkloadTokens,
                    settings.WorkloadVerificationKeys,
                    context.RequestAborted);
            }
            catch (TokenValidationException)
            {
                outcome = "proxy_authentication_rejected";
                context.Response.Headers.ProxyAuthenticate = "Bearer";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status407ProxyAuthenticationRequired,
                    "Proxy authentication required",
                    context.RequestAborted);
                return;
            }

            RequestTarget target;
            try
            {
                target = await ParseRequestTarget(
                    context.Request,
                    context.RequestAborted);
            }
            catch (InvalidRequestTargetException)
            {
                outcome = "request_rejected";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status400BadRequest,
                    "Bad request",
                    context.RequestAborted);
                return;
            }

            var selection = await SelectRule(
                settings.Configuration.Binding.Rules,
                method.Value,
                target.Path,
                context.RequestAborted);
            if (selection is RuleSelection.Missing)
            {
                outcome = "path_not_found";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status404NotFound,
                    "Not found",
                    context.RequestAborted);
                return;
            }
            if (selection is RuleSelection.MethodNotAllowed rejected)
            {
                outcome = "method_not_allowed";
                context.Response.Headers.Allow = string.Join(
                    ", ",
                    rejected.Methods
                        .Select(FormatHttpMethod)
                        .Order(StringComparer.Ordinal));
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status405MethodNotAllowed,
                    "Method not allowed",
                    context.RequestAborted);
                return;
            }

            var rule = ((RuleSelection.Selected)selection).Rule;
            ruleId = rule.RuleId.Value;
            if (context.Request.ContentLength
                > rule.MaximumRequestBodyBytes)
            {
                outcome = "request_body_too_large";
                await WriteBoundaryError(
                    context,
                    StatusCodes.Status413PayloadTooLarge,
                    "Request body too large",
                    context.RequestAborted);
                return;
            }
            if (!admission.TryAcquire(out saturation))
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
                outcome = await ProxyRequest(
                    context,
                    target,
                    rule,
                    settings,
                    upstream,
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
                ruleId,
                outcome,
                context.Response.StatusCode,
                saturation,
                started);
        }
    }

    private static async Task<string> ProxyRequest(
        HttpContext context,
        RequestTarget target,
        EgressRule rule,
        ServiceSettings settings,
        HttpClient upstream,
        EgressdTelemetry telemetry)
    {
        using var outgoing = await CreateUpstreamRequest(
            context,
            target,
            rule,
            settings.Configuration.Secrets,
            settings.Proxy.Origin,
            context.RequestAborted);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted);
        timeout.CancelAfter(settings.Proxy.UpstreamTimeout);
        var dependencyStarted =
            System.Diagnostics.Stopwatch.GetTimestamp();
        using var dependencyActivity = telemetry.StartUpstream();
        HttpResponseMessage? response = null;
        var dependencyOutcome = "unavailable";
        try
        {
            if (rule.ForwardTraceContext)
            {
                EgressdTelemetry.InjectTraceContext(outgoing);
            }
            response = await upstream.SendAsync(
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
            await CopyUpstreamResponse(
                context,
                response,
                rule,
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
        catch (InvalidRequestTargetException)
        {
            dependencyOutcome = "request_rejected";
            await WriteBoundaryError(
                context,
                StatusCodes.Status400BadRequest,
                "Bad request",
                context.RequestAborted);
            return dependencyOutcome;
        }
        catch (ResponseBodyTooLargeException)
        {
            dependencyOutcome = "response_body_too_large";
            await WriteBoundaryError(
                context,
                StatusCodes.Status502BadGateway,
                "Bad gateway",
                context.RequestAborted);
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
            dependencyOutcome = "upstream_unavailable";
            await WriteBoundaryError(
                context,
                StatusCodes.Status502BadGateway,
                "Bad gateway",
                context.RequestAborted);
            return dependencyOutcome;
        }
        catch (Exception)
        {
            dependencyOutcome = "upstream_failure";
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
            telemetry.RecordUpstream(
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
