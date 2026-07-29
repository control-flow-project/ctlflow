using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Dependencies.DependencyAuthentication;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Execution.Execd.Service.Identity;

internal static partial class RunInvocations
{
    internal static async Task<InvocationCredential> IssueRunInvocation(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        ExecdTelemetry telemetry,
        RunRecord run,
        DateTimeOffset now,
        CancellationToken cancellation)
    {
        var actor = run.ActorPrincipalId
            ?? throw new InvalidOperationException(
                "Non-Global Run has no Actor");
        var tenantId = run.Target.TenantAnchor
            ?? throw new InvalidOperationException(
                "Global Run has no invocation");
        var request = new IssueRunInvocationRequest
        {
            PrincipalId = actor.Value,
            TenantId = tenantId.Value,
            RunId = run.Id.Value
        };
        if (run.Target is PlacementTarget.Workspace workspace)
        {
            request.WorkspaceId = workspace.WorkspaceId.Value;
        }

        var token = await ReadWorkloadToken(
            settings.WorkloadTokenFilePath,
            cancellation);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartDependencyCall(
            "ctlflow.identity.v1.IdentityService",
            "IssueRunInvocation");
        var outcome = "UNAVAILABLE";
        try
        {
            var response = await client.IssueRunInvocationAsync(
                request,
                CreateDependencyHeaders(token),
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            if (response.ExpiresAt is null
                || response.InvocationJwt.Length is < 1 or > 16_384)
            {
                throw InvalidResponse();
            }

            var expiresAt = response.ExpiresAt.ToDateTimeOffset();
            if (expiresAt <= now
                || expiresAt > now.AddSeconds(60))
            {
                throw InvalidResponse();
            }

            outcome = "OK";
            return new InvocationCredential(
                response.InvocationJwt,
                expiresAt);
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "CANCELLED";
            throw;
        }
        catch (RpcException exception)
        {
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw exception.StatusCode switch
            {
                StatusCode.NotFound
                    or StatusCode.PermissionDenied
                    or StatusCode.Unauthenticated =>
                    new ExecutionException(
                        ExecutionError.FailedPrecondition,
                        "Run invocation is not admitted"),
                _ => new ExecutionException(
                    ExecutionError.Unavailable,
                    "Identityd is unavailable")
            };
        }
        finally
        {
            telemetry.RecordDependencyCall(
                activity,
                "IssueRunInvocation",
                outcome,
                started);
        }
    }

    private static ExecutionException InvalidResponse() =>
        new(
            ExecutionError.Unavailable,
            "Identityd returned an invalid invocation");
}
