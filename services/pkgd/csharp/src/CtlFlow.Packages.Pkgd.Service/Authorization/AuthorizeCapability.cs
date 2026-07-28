using System.Diagnostics;
using System.Globalization;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Service.Configuration;
using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Packages.Pkgd.Service.Authorization;

internal static partial class PackageAuthorization
{
    internal static async Task AuthorizeCapability(
        PolicyService.PolicyServiceClient policyClient,
        PolicySettings settings,
        PkgdTelemetry telemetry,
        PackageRequestIdentity identity,
        PkgdCapability capability,
        AppScope scope,
        AppId? appId,
        CancellationToken cancellation)
    {
        EnsureInvocationFence(identity, scope);
        if (identity.Admission != PackageAdmission.Capability)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        var target = CreatePolicyTarget(scope);
        var request = new CheckAccessRequest
        {
            Operation = GetOperation(capability),
            ResourcePath = CreateResourcePath(scope, appId),
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
                    "Policy workload token is invalid"));
        }

        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" },
            {
                "ctlflow-invocation",
                $"Bearer {invocation.Token.ReadForPolicyForwarding()}"
            }
        };
        var started = Stopwatch.GetTimestamp();
        using var activity = telemetry.StartPolicyCheck();
        AddTraceContext(headers, activity);
        var outcome = "UNAVAILABLE";
        string? decision = null;
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
                    outcome = "OK";
                    decision = "allow";
                    return;
                case AccessDecision.Deny:
                    outcome = "OK";
                    decision = "deny";
                    throw new CapabilityDeniedException();
                default:
                    throw new PolicyUnavailableException(
                        new InvalidDataException(
                            "policyd returned an invalid decision"));
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
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw new OperationCanceledException(cancellation);
        }
        catch (RpcException exception)
        {
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw MapPolicyFailure(exception);
        }
        finally
        {
            telemetry.RecordPolicyCheck(
                activity,
                outcome,
                decision,
                started);
        }
    }

    private static void EnsureInvocationFence(
        PackageRequestIdentity identity,
        AppScope scope)
    {
        if (identity.Admission != PackageAdmission.Capability)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        switch (scope)
        {
            case AppScope.Global:
                throw new CapabilityDeniedException();
            case AppScope.Tenant tenant:
                EnsureTenantFence(
                    invocation.TenantId,
                    invocation.WorkspaceId,
                    tenant.TenantId);
                break;
            case AppScope.Workspace workspace:
                if (invocation.TenantId != workspace.TenantId
                    || invocation.WorkspaceId != workspace.WorkspaceId)
                {
                    throw new AuthorizationTargetNotFoundException();
                }

                break;
            case AppScope.User user:
                EnsureTenantFence(
                    invocation.TenantId,
                    invocation.WorkspaceId,
                    user.TenantId);
                if (invocation.SubjectAccount.Value
                    != user.AccountPrincipalId.Value)
                {
                    throw new AuthorizationTargetNotFoundException();
                }

                break;
            default:
                throw new InvalidOperationException("App scope is invalid");
        }
    }

    private static void EnsureTenantFence(
        TenantId? invocationTenant,
        WorkspaceId? invocationWorkspace,
        TenantId targetTenant)
    {
        if (invocationTenant != targetTenant
            || invocationWorkspace is not null)
        {
            throw new AuthorizationTargetNotFoundException();
        }
    }

    private static PolicyTarget CreatePolicyTarget(AppScope scope) =>
        scope switch
        {
            AppScope.Tenant tenant =>
                new PolicyTarget(tenant.TenantId, null),
            AppScope.Workspace workspace =>
                new PolicyTarget(
                    workspace.TenantId,
                    workspace.WorkspaceId),
            AppScope.User user =>
                new PolicyTarget(user.TenantId, null),
            _ => throw new CapabilityDeniedException()
        };

    private static string GetOperation(PkgdCapability capability) =>
        capability switch
        {
            PkgdCapability.CreateApp => "apps.create",
            PkgdCapability.ReadApp => "apps.read",
            PkgdCapability.SetAppPackageGeneration =>
                "apps.set_package_generation",
            _ => throw new InvalidOperationException(
                "Pkgd capability is invalid")
        };

    private static string CreateResourcePath(
        AppScope scope,
        AppId? appId)
    {
        var collection = scope switch
        {
            AppScope.Global => "/apps",
            AppScope.Tenant tenant =>
                $"/tenants/{tenant.TenantId.Value}/apps",
            AppScope.Workspace workspace =>
                $"/tenants/{workspace.TenantId.Value}"
                + $"/workspaces/{workspace.WorkspaceId.Value}/apps",
            AppScope.User user =>
                $"/tenants/{user.TenantId.Value}"
                + $"/accounts/{user.AccountPrincipalId.Value}/apps",
            _ => throw new InvalidOperationException("App scope is invalid")
        };
        return appId is null
            ? collection
            : $"{collection}/{appId.Value}";
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

    private sealed record PolicyTarget(
        TenantId TenantId,
        WorkspaceId? WorkspaceId);
}
