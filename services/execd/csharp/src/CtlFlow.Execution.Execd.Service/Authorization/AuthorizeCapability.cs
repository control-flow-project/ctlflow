using System.Diagnostics;
using System.Globalization;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Execution.Execd.Service.Authorization;

internal static partial class ExecutionAuthorization
{
    internal static async Task AuthorizeCapability(
        PolicyService.PolicyServiceClient policyClient,
        PolicySettings settings,
        ExecdTelemetry telemetry,
        ExecutionRequestIdentity identity,
        ExecdCapability capability,
        PlacementTarget target,
        PlacementId? placementId,
        WorkloadId? workloadId,
        RunId? runId,
        CancellationToken cancellation)
    {
        EnsureInvocationFence(identity, target);
        if (identity.Admission == ExecutionAdmission.Operator)
        {
            return;
        }

        if (identity.Admission != ExecutionAdmission.Capability)
        {
            throw new CapabilityDeniedException();
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        var request = new CheckAccessRequest
        {
            Operation = GetOperation(capability),
            ResourcePath = CreateResourcePath(
                capability,
                target,
                placementId,
                workloadId,
                runId),
            TenantId = target.TenantAnchor!.Value
        };
        if (target is PlacementTarget.Workspace workspace)
        {
            request.WorkspaceId = workspace.WorkspaceId.Value;
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
        ExecutionRequestIdentity identity,
        PlacementTarget target)
    {
        if (identity.Admission == ExecutionAdmission.Operator)
        {
            return;
        }

        var invocation = identity.Invocation
            ?? throw new TokenValidationException();
        switch (target)
        {
            case PlacementTarget.Global:
                throw new CapabilityDeniedException();
            case PlacementTarget.Tenant tenant:
                EnsureTenantFence(
                    invocation.TenantId,
                    invocation.WorkspaceId,
                    tenant.TenantId);
                break;
            case PlacementTarget.Workspace workspace:
                if (invocation.TenantId != workspace.TenantId
                    || invocation.WorkspaceId != workspace.WorkspaceId)
                {
                    throw new AuthorizationTargetNotFoundException();
                }

                break;
            case PlacementTarget.User user:
                EnsureTenantFence(
                    invocation.TenantId,
                    invocation.WorkspaceId,
                    user.TenantId);
                if (!string.Equals(
                        invocation.SubjectAccount.Value,
                        user.AccountPrincipalId.Value,
                        StringComparison.Ordinal))
                {
                    throw new AuthorizationTargetNotFoundException();
                }

                break;
            default:
                throw new InvalidOperationException(
                    "Placement target is invalid");
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

    private static string GetOperation(ExecdCapability capability) =>
        capability switch
        {
            ExecdCapability.DeclarePlacement =>
                "placements.declare",
            ExecdCapability.ReadPlacement => "placements.read",
            ExecdCapability.DeclareWorkload =>
                "workloads.declare",
            ExecdCapability.ReadWorkload => "workloads.read",
            ExecdCapability.CreateRun => "runs.create",
            ExecdCapability.ReadRun => "runs.read",
            ExecdCapability.CancelRun => "runs.cancel",
            _ => throw new InvalidOperationException(
                "Execd capability is invalid")
        };

    private static string CreateResourcePath(
        ExecdCapability capability,
        PlacementTarget target,
        PlacementId? placementId,
        WorkloadId? workloadId,
        RunId? runId)
    {
        var scope = target switch
        {
            PlacementTarget.Tenant tenant =>
                $"/tenants/{tenant.TenantId.Value}",
            PlacementTarget.Workspace workspace =>
                $"/tenants/{workspace.TenantId.Value}"
                + $"/workspaces/{workspace.WorkspaceId.Value}",
            PlacementTarget.User user =>
                $"/tenants/{user.TenantId.Value}"
                + $"/accounts/{user.AccountPrincipalId.Value}",
            _ => throw new CapabilityDeniedException()
        };
        var path = $"{scope}/placements";
        if (placementId is not null)
        {
            path += $"/{placementId.Value}";
        }

        if (capability is ExecdCapability.DeclareWorkload
                or ExecdCapability.ReadWorkload
                or ExecdCapability.CreateRun
                or ExecdCapability.ReadRun
                or ExecdCapability.CancelRun)
        {
            path += "/workloads";
            if (workloadId is not null)
            {
                path += $"/{workloadId.Value}";
            }
        }

        if (capability is ExecdCapability.CreateRun
                or ExecdCapability.ReadRun
                or ExecdCapability.CancelRun)
        {
            path += "/runs";
            if (runId is not null)
            {
                path += $"/{runId.Value}";
            }
        }

        return path;
    }

    private static Exception MapPolicyFailure(RpcException exception) =>
        exception.StatusCode switch
        {
            StatusCode.Unauthenticated =>
                new TokenValidationException(),
            StatusCode.PermissionDenied =>
                new CapabilityDeniedException(),
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
