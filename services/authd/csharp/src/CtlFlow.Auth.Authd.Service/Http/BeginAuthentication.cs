using CtlFlow.Auth.Authd.Domain.Browser;
using CtlFlow.Auth.Authd.Domain.Identifiers;
using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Domain.State;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Identity;
using CtlFlow.Auth.Authd.Service.State;
using CtlFlow.Auth.Authd.Service.Tenancy;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using CtlFlow.Tenancy.V1;
using Microsoft.Net.Http.Headers;
using static CtlFlow.Auth.Authd.Service.Http.BrowserRequests;
using static CtlFlow.Auth.Authd.Service.Http.FormEncoding;
using static CtlFlow.Auth.Authd.Service.Http.HttpResponses;
using static CtlFlow.Auth.Authd.Service.Identity.IdentityCalls;
using static CtlFlow.Auth.Authd.Service.Oidc.OidcAuthorization;
using static CtlFlow.Auth.Authd.Service.Tenancy.TenantCalls;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class BrowserRoutes
{
    internal static async Task BeginAuthentication(
        HttpContext context,
        AuthdSettings settings,
        AuthenticationAttemptStore attempts,
        IdentityService.IdentityServiceClient identityClient,
        TenantService.TenantServiceClient tenantClient,
        AuthdTelemetry telemetry)
    {
        const string operation = "authd.http.begin";
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
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
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
                maximumFields: 4,
                optional: false,
                timeout.Token);
            if (!fields.Remove("tenant_id", out var tenantValue)
                || !fields.Remove("provider_id", out var providerValue))
            {
                throw InvalidBegin();
            }
            ReturnTarget returnTarget;
            TenantId tenantId;
            WorkspaceId? workspaceId;
            ProviderId providerId;
            try
            {
                returnTarget = fields.Remove(
                        "return_to",
                        out var returnValue)
                    ? ReturnTarget.Parse(returnValue)
                    : ReturnTarget.Default;
                tenantId = TenantId.Parse(tenantValue);
                workspaceId = fields.Remove(
                        "workspace_id",
                        out var workspaceValue)
                    ? WorkspaceId.Parse(workspaceValue)
                    : null;
                providerId = ProviderId.Parse(providerValue);
            }
            catch (ArgumentException)
            {
                throw InvalidBegin();
            }
            if (fields.Count != 0)
            {
                throw InvalidBegin();
            }
            var stateCookie = BrowserCookies.Read(
                context.Request,
                BrowserCookies.StateName);
            if (stateCookie.State == CookieReadState.Invalid)
            {
                throw InvalidBegin();
            }
            var provider = settings.Projection.Find(
                tenantId,
                providerId)
                ?? throw InvalidBegin();
            dependency = "tenantd";
            await ValidateLoginTarget(
                tenantClient,
                settings.Workload,
                telemetry,
                tenantId,
                workspaceId,
                timeout.Token);
            dependency = "identityd";
            await ValidateLoginProviderSelection(
                identityClient,
                settings.Workload,
                telemetry,
                provider,
                workspaceId,
                timeout.Token);

            var now = DateTimeOffset.UtcNow;
            var verifier = PkceVerifier.Generate();
            var attempt = new AuthenticationAttempt(
                tenantId,
                workspaceId,
                providerId,
                returnTarget,
                verifier,
                now,
                now.AddMinutes(10));
            CreatedAuthenticationAttempt created;
            Uri authorization;
            try
            {
                var stateHandle = BrowserValues.Generate();
                authorization = CreateAuthorizationUri(
                    provider,
                    settings.Projection.CallbackUri,
                    stateHandle,
                    verifier);
                created = attempts.Create(
                    attempt,
                    stateCookie.Value,
                    now,
                    stateHandle);
            }
            catch
            {
                attempt.Dispose();
                throw;
            }

            context.Response.Headers.Append(
                HeaderNames.SetCookie,
                BrowserCookies.CreateStateCookie(
                    created.BrowserNonce));
            WriteRedirect(
                context.Response,
                authorization.AbsoluteUri);
            status = StatusCodes.Status303SeeOther;
            outcome = "redirect";
            dependency = "none";
        }
        catch (Exception exception)
        {
            (status, outcome, dependency) =
                MapBeginFailure(exception, dependency);
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
        string Dependency) MapBeginFailure(
            Exception exception,
            string currentDependency) =>
        exception switch
        {
            HttpContractException contract =>
                (contract.StatusCode, contract.Outcome, "none"),
            LoginProviderRejectedException =>
                (StatusCodes.Status400BadRequest,
                    "invalid_request",
                    currentDependency),
            DependencyUnavailableException unavailable =>
                (StatusCodes.Status503ServiceUnavailable,
                    "dependency_unavailable",
                    unavailable.Dependency),
            InvalidDataException =>
                (StatusCodes.Status503ServiceUnavailable,
                    "projection_unavailable",
                    currentDependency),
            OperationCanceledException =>
                (StatusCodes.Status503ServiceUnavailable,
                    "deadline",
                    currentDependency),
            _ => (StatusCodes.Status500InternalServerError,
                "internal",
                currentDependency)
        };

    private static HttpContractException InvalidBegin() =>
        new(StatusCodes.Status400BadRequest, "invalid_request");
}
