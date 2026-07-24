using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.WorkspaceRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.WorkspaceResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Security.TenantRequestAuthentication;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ResolveWorkspaceResponse> ResolveWorkspace(
        ResolveWorkspaceRequest request,
        ServerCallContext context)
    {
        using var activity = _telemetry.StartResolveWorkspace(context.RequestHeaders);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var currentTime = DateTimeOffset.UtcNow;
            var identity = await AuthenticateTenantRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                _settings.ResolveWorkspaceCallers,
                currentTime,
                context.CancellationToken);
            var lookup = await ParseWorkspaceLookup(
                request,
                context.CancellationToken);

            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var result = await QueryWorkspaceResolution(
                _databaseContexts,
                lookup,
                _settings.CacheLifetime,
                UtcInstant.FromClock(currentTime),
                context.CancellationToken);
            result = ApplyInvocationFence(result, lookup.TenantId, identity);

            var response = await CreateResolveWorkspaceResponse(
                result,
                context.CancellationToken);
            outcome = "ok";
            return response;
        }
        catch (TokenValidationException)
        {
            outcome = "unauthenticated";
            throw new RpcException(
                new Status(StatusCode.Unauthenticated, "Authentication failed"));
        }
        catch (CallerNotAdmittedException)
        {
            outcome = "permission_denied";
            throw new RpcException(
                new Status(StatusCode.PermissionDenied, "Caller is not admitted"));
        }
        catch (TokenKeySourceException)
        {
            outcome = "unavailable";
            throw Unavailable();
        }
        catch (Exception) when (context.CancellationToken.IsCancellationRequested)
        {
            // Any exception raised while the call is cancelled — a cancellation
            // token thrown by EF, or a provider exception from an interrupted
            // query — is reported as cancellation, not as an internal error.
            var deadlineExceeded = context.Deadline <= DateTimeOffset.UtcNow;
            outcome = deadlineExceeded ? "deadline_exceeded" : "cancelled";
            throw new RpcException(new Status(
                deadlineExceeded
                    ? StatusCode.DeadlineExceeded
                    : StatusCode.Cancelled,
                "Request was cancelled"));
        }
        catch (DbException)
        {
            outcome = "unavailable";
            throw Unavailable();
        }
        catch (InvalidOperationException)
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
            _telemetry.RecordResolveWorkspace(activity, outcome, started);
        }
    }

    private static ResolveWorkspaceResult ApplyInvocationFence(
        ResolveWorkspaceResult result,
        TenantId parentTenantId,
        TenantRequestIdentity identity)
    {
        if (result is not ResolveWorkspaceResult.Found found
            || identity.Invocation is not { } invocation)
        {
            return result;
        }

        if (invocation.TenantId is { } tenantId && parentTenantId != tenantId)
        {
            return new ResolveWorkspaceResult.NotFound();
        }

        if (invocation.WorkspaceId is { } workspaceId
            && found.Resolution.WorkspaceId != workspaceId)
        {
            return new ResolveWorkspaceResult.NotFound();
        }

        return result;
    }
}
