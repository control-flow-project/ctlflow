using System.Diagnostics;
using System.Globalization;
using CtlFlow.Policy.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Authorization;

internal static partial class TenantAuthorization
{
    internal static async Task AuthorizeTenantCapability(
        PolicyService.PolicyServiceClient policyClient,
        PolicySettings settings,
        TenantdTelemetry telemetry,
        TenantRequestIdentity identity,
        TenantCapability capability,
        TenantId tenantId,
        WorkspaceId? workspaceId,
        CancellationToken cancellation)
    {
        EnsureInvocationFence(
            identity,
            capability,
            tenantId,
            workspaceId);
        if (identity.Admission != TenantAdmission.Capability)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        var operation = GetOperation(capability);
        var resourcePath = CreateResourcePath(
            capability,
            tenantId,
            workspaceId);
        var request = new CheckAccessRequest
        {
            Operation = operation,
            ResourcePath = resourcePath,
            TenantId = tenantId.Value
        };
        if (workspaceId is not null)
        {
            request.WorkspaceId = workspaceId.Value;
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
                $"Bearer {invocation.Token.ReadForPolicyForwarding()}"
            }
        };
        var started = Stopwatch.GetTimestamp();
        using var activity = telemetry.StartPolicyCheck();
        AddTraceContext(headers, activity);
        var outcome = "unavailable";
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
                    outcome = "allow";
                    return;
                case AccessDecision.Deny:
                    outcome = "deny";
                    throw new CapabilityDeniedException();
                default:
                    throw new PolicyUnavailableException(
                        new InvalidDataException(
                            "policyd returned an invalid access decision"));
            }
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "cancelled";
            throw;
        }
        catch (RpcException exception) when (
            cancellation.IsCancellationRequested
            && exception.StatusCode is StatusCode.Cancelled
                or StatusCode.DeadlineExceeded)
        {
            outcome = "cancelled";
            throw new OperationCanceledException(cancellation);
        }
        catch (RpcException exception)
        {
            outcome = exception.StatusCode
                .ToString()
                .ToLowerInvariant();
            throw MapPolicyFailure(exception);
        }
        finally
        {
            telemetry.RecordPolicyCheck(activity, outcome, started);
        }
    }

    private static void EnsureInvocationFence(
        TenantRequestIdentity identity,
        TenantCapability capability,
        TenantId tenantId,
        WorkspaceId? workspaceId)
    {
        var invocation = identity.Invocation;
        if (invocation is null)
        {
            if (identity.Admission == TenantAdmission.Capability)
            {
                throw new TokenValidationException();
            }

            return;
        }

        if (invocation.TenantId is { } fencedTenant
            && fencedTenant != tenantId)
        {
            throw new AuthorizationTargetNotFoundException();
        }
        if (identity.Admission == TenantAdmission.Capability
            && invocation.TenantId is null)
        {
            throw new AuthorizationTargetNotFoundException();
        }

        if (workspaceId is { } targetWorkspace)
        {
            if (invocation.WorkspaceId is { } fencedWorkspace
                && fencedWorkspace != targetWorkspace)
            {
                throw new AuthorizationTargetNotFoundException();
            }

            return;
        }

        if (IsWorkspaceCollection(capability)
            && invocation.WorkspaceId is not null)
        {
            throw new AuthorizationTargetNotFoundException();
        }
    }

    private static string GetOperation(TenantCapability capability) =>
        capability switch
        {
            TenantCapability.ReadTenant => "tenants.read",
            TenantCapability.UpdateTenantDisplayName =>
                "tenants.update_display_name",
            TenantCapability.CreateWorkspace => "workspaces.create",
            TenantCapability.ReadWorkspace => "workspaces.read",
            TenantCapability.UpdateWorkspaceDisplayName =>
                "workspaces.update_display_name",
            TenantCapability.SuspendWorkspace => "workspaces.suspend",
            TenantCapability.ResumeWorkspace => "workspaces.resume",
            TenantCapability.DeleteWorkspace => "workspaces.delete",
            _ => throw new InvalidOperationException(
                "Tenant capability is invalid")
        };

    private static string CreateResourcePath(
        TenantCapability capability,
        TenantId tenantId,
        WorkspaceId? workspaceId)
    {
        var tenantPath = $"/tenants/{tenantId.Value}";
        if (capability is TenantCapability.ReadTenant
            or TenantCapability.UpdateTenantDisplayName)
        {
            return tenantPath;
        }

        var workspacePath = $"{tenantPath}/workspaces";
        return workspaceId is null
            ? workspacePath
            : $"{workspacePath}/{workspaceId.Value}";
    }

    private static bool IsWorkspaceCollection(
        TenantCapability capability) =>
        capability is TenantCapability.CreateWorkspace
            or TenantCapability.ReadWorkspace;

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
