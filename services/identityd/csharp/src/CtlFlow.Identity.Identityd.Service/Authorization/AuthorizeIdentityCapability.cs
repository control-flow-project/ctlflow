using System.Diagnostics;
using System.Globalization;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using CtlFlow.Identity.Identityd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;

namespace CtlFlow.Identity.Identityd.Service.Authorization;

internal static partial class IdentityAuthorization
{
    internal static async Task AuthorizeIdentityCapability(
        PolicyService.PolicyServiceClient policyClient,
        PolicySettings settings,
        IdentitydTelemetry telemetry,
        IdentityRequestIdentity identity,
        IdentityAdminOperation operation,
        IdentityTarget target,
        string resourcePath,
        CancellationToken cancellation)
    {
        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        if (!await Invocations.ContainsAdminTarget(
                invocation,
                target,
                cancellation))
        {
            throw new AuthorizationTargetNotFoundException();
        }

        var invocationToken = identity.InvocationToken
            ?? throw new TokenValidationException();
        var request = new CheckAccessRequest
        {
            Operation = GetIdentityOperation(operation),
            ResourcePath = resourcePath,
            TenantId = target.TenantId.Value
        };
        if (target.WorkspaceId is not null)
        {
            request.WorkspaceId = target.WorkspaceId.Value;
        }

        var token = (await File.ReadAllTextAsync(
            settings.WorkloadTokenFilePath,
            cancellation)).Trim();
        if (token.Length is < 1 or > 16_384)
        {
            throw new PolicyUnavailableException(
                new InvalidDataException(
                    "The policy workload token is invalid"));
        }

        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" },
            {
                "ctlflow-invocation",
                $"Bearer {invocationToken.ReadForPolicyForwarding()}"
            }
        };
        using var activity = telemetry.StartPolicyCheck();
        AddTraceContext(headers, activity);
        var started = Stopwatch.GetTimestamp();
        var outcome = "UNAVAILABLE";
        try
        {
            var response = await policyClient.CheckAccessAsync(
                request,
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            switch (response.Decision)
            {
                case AccessDecision.Allow:
                    outcome = "ALLOW";
                    return;
                case AccessDecision.Deny:
                    outcome = "DENY";
                    throw new CapabilityDeniedException();
                default:
                    throw new PolicyUnavailableException(
                        new InvalidDataException(
                            "Policyd returned an invalid decision"));
            }
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "CANCELLED";
            throw;
        }
        catch (RpcException exception) when (
            cancellation.IsCancellationRequested
            && exception.StatusCode is StatusCode.Cancelled
                or StatusCode.DeadlineExceeded)
        {
            outcome = "CANCELLED";
            throw new OperationCanceledException(cancellation);
        }
        catch (RpcException exception)
        {
            outcome = exception.StatusCode.ToString().ToUpperInvariant();
            throw MapPolicyFailure(exception);
        }
        finally
        {
            telemetry.RecordPolicyCheck(activity, outcome, started);
        }
    }

    private static Exception MapPolicyFailure(RpcException exception) =>
        exception.StatusCode switch
        {
            StatusCode.Unauthenticated => new TokenValidationException(),
            StatusCode.PermissionDenied => new CapabilityDeniedException(),
            StatusCode.NotFound =>
                new AuthorizationTargetNotFoundException(),
            _ => new PolicyUnavailableException(exception)
        };

    private static void AddTraceContext(
        Metadata headers,
        Activity? activity)
    {
        if (activity is null)
        {
            return;
        }

        var flags = ((byte)activity.ActivityTraceFlags).ToString(
            "x2",
            CultureInfo.InvariantCulture);
        headers.Add(
            "traceparent",
            $"00-{activity.TraceId}-{activity.SpanId}-{flags}");
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }
}
