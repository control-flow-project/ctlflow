using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.Lifecycles;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.LifecycleRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.LifecycleResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Security.TenantRequestAuthentication;
using DomainLifecycleTarget =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTarget;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<GetLifecycleResponse> GetLifecycle(
        GetLifecycleRequest request,
        ServerCallContext context)
    {
        using var activity = _telemetry.StartGrpcOperation(
            "GetLifecycle",
            context.RequestHeaders);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var currentTime = DateTimeOffset.UtcNow;
            var identity = await AuthenticateTenantRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                _settings.GetLifecycleCallers,
                currentTime,
                context.CancellationToken);
            var target = await ParseLifecycleTarget(
                request.Target,
                context.CancellationToken);
            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var result = await QueryLifecycle(
                _databaseContexts,
                target,
                _settings.CacheLifetime,
                UtcInstant.FromClock(currentTime),
                context.CancellationToken);
            result = ApplyInvocationFence(result, identity);
            var response = await CreateGetLifecycleResponse(
                result,
                context.CancellationToken);
            outcome = "ok";
            return response;
        }
        catch (ArgumentException)
        {
            outcome = "invalid_argument";
            throw new RpcException(new Status(
                StatusCode.InvalidArgument,
                "Lifecycle target is invalid"));
        }
        catch (TokenValidationException)
        {
            outcome = "unauthenticated";
            throw new RpcException(new Status(
                StatusCode.Unauthenticated,
                "Authentication failed"));
        }
        catch (CallerNotAdmittedException)
        {
            outcome = "permission_denied";
            throw new RpcException(new Status(
                StatusCode.PermissionDenied,
                "Caller is not admitted"));
        }
        catch (TokenKeySourceException)
        {
            outcome = "unavailable";
            throw Unavailable();
        }
        catch (Exception) when (context.CancellationToken.IsCancellationRequested)
        {
            var deadlineExceeded = context.Deadline <= DateTimeOffset.UtcNow;
            outcome = deadlineExceeded ? "deadline_exceeded" : "cancelled";
            throw new RpcException(new Status(
                deadlineExceeded
                    ? StatusCode.DeadlineExceeded
                    : StatusCode.Cancelled,
                "Request was cancelled"));
        }
        catch (Exception exception) when (
            exception is DbException or InvalidOperationException)
        {
            outcome = "unavailable";
            throw Unavailable();
        }
        catch (RpcException exception)
        {
            outcome = MapOutcome(exception.StatusCode);
            throw;
        }
        finally
        {
            _telemetry.RecordGrpcOperation(
                activity,
                "GetLifecycle",
                outcome,
                started);
        }
    }

    private static GetLifecycleResult ApplyInvocationFence(
        GetLifecycleResult result,
        TenantRequestIdentity identity)
    {
        if (result is not GetLifecycleResult.Found found
            || identity.Invocation is not { } invocation)
        {
            return result;
        }

        var outsideTenant = invocation.TenantId is { } tenantId
            && found.Fact.Target switch
            {
                DomainLifecycleTarget.Tenant tenantTarget =>
                    tenantTarget.TenantId != tenantId,
                DomainLifecycleTarget.Workspace workspaceTarget =>
                    workspaceTarget.TenantId != tenantId,
                _ => true
            };
        var outsideWorkspace = invocation.WorkspaceId is { } workspaceId
            && (
                found.Fact.Target
                    is not DomainLifecycleTarget.Workspace fencedWorkspace
                || fencedWorkspace.WorkspaceId != workspaceId);
        return outsideTenant || outsideWorkspace
            ? new GetLifecycleResult.NotFound()
            : result;
    }
}
