using System.Diagnostics;
using System.Globalization;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Security;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using CtlFlow.Configuration.Configd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Configuration.Configd.Service.Authorization;

internal static partial class ConfigdAuthorization
{
    internal static async Task AuthorizeCapability(
        PolicyService.PolicyServiceClient policyClient,
        PolicySettings settings,
        ConfigdTelemetry telemetry,
        ConfigRequestIdentity identity,
        ConfigdCapability capability,
        ConsumerBinding binding,
        string resourceId,
        CancellationToken cancellation)
    {
        EnsureInvocationFence(identity, binding);
        if (identity.Admission != ConfigAdmission.Capability)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        var target = CreatePolicyTarget(binding.Placement.Scope);
        var request = new CheckAccessRequest
        {
            Operation = GetOperation(capability),
            ResourcePath = CreateResourcePath(
                binding,
                capability,
                resourceId),
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
        ConfigRequestIdentity identity,
        ConsumerBinding binding)
    {
        if (identity.Admission != ConfigAdmission.Capability)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        switch (binding.Placement.Scope)
        {
            case PlacementScope.Global:
                throw new CapabilityDeniedException();
            case PlacementScope.Tenant tenant:
                EnsureTenantFence(
                    invocation.TenantId,
                    invocation.WorkspaceId,
                    tenant.TenantId);
                break;
            case PlacementScope.Workspace workspace:
                if (invocation.TenantId != workspace.TenantId
                    || invocation.WorkspaceId is not null
                    && invocation.WorkspaceId != workspace.WorkspaceId)
                {
                    throw new AuthorizationTargetNotFoundException();
                }

                break;
            case PlacementScope.User user:
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
                throw new InvalidOperationException(
                    "Placement scope is invalid");
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

    private static PolicyTarget CreatePolicyTarget(PlacementScope scope) =>
        scope switch
        {
            PlacementScope.Tenant tenant =>
                new PolicyTarget(tenant.TenantId, null),
            PlacementScope.Workspace workspace =>
                new PolicyTarget(
                    workspace.TenantId,
                    workspace.WorkspaceId),
            PlacementScope.User user =>
                new PolicyTarget(user.TenantId, null),
            _ => throw new CapabilityDeniedException()
        };

    private static string GetOperation(ConfigdCapability capability) =>
        capability switch
        {
            ConfigdCapability.PublishConfiguration =>
                "configurations.publish",
            ConfigdCapability.ReadConfiguration =>
                "configurations.read",
            ConfigdCapability.PublishSecret => "secrets.publish",
            ConfigdCapability.ReadSecretMetadata =>
                "secrets.read_metadata",
            _ => throw new InvalidOperationException(
                "Configd capability is invalid")
        };

    private static string CreateResourcePath(
        ConsumerBinding binding,
        ConfigdCapability capability,
        string resourceId)
    {
        var prefix = binding.Placement.Scope switch
        {
            PlacementScope.Tenant tenant =>
                $"/tenants/{tenant.TenantId.Value}",
            PlacementScope.Workspace workspace =>
                $"/tenants/{workspace.TenantId.Value}"
                + $"/workspaces/{workspace.WorkspaceId.Value}",
            PlacementScope.User user =>
                $"/tenants/{user.TenantId.Value}"
                + $"/accounts/{user.AccountPrincipalId.Value}",
            _ => throw new CapabilityDeniedException()
        };
        var collection = capability switch
        {
            ConfigdCapability.PublishConfiguration
                or ConfigdCapability.ReadConfiguration => "configurations",
            ConfigdCapability.PublishSecret
                or ConfigdCapability.ReadSecretMetadata => "secrets",
            _ => throw new InvalidOperationException(
                "Configd capability is invalid")
        };
        return $"{prefix}/placements/{binding.Placement.PlacementId.Value}"
            + $"/consumers/{binding.ConsumerId.Value}"
            + $"/purposes/{binding.Purpose.Value}"
            + $"/{collection}/{resourceId}";
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
