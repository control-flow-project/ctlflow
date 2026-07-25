using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.TenantRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenantResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Security.TenantRequestAuthentication;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ResolveTenantResponse> ResolveTenant(
        ResolveTenantRequest request,
        ServerCallContext context)
    {
        using var activity = _telemetry.StartResolveTenant(context.RequestHeaders);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var currentTime = DateTimeOffset.UtcNow;
            var identity = await AuthenticateTenantRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                _settings.ResolveTenantCallers,
                currentTime,
                context.CancellationToken);
            var selector = await ParseTenantSelector(
                request,
                context.CancellationToken);

            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var result = await QueryTenantResolution(
                _databaseContexts,
                selector,
                _settings.CacheLifetime,
                UtcInstant.FromClock(currentTime),
                context.CancellationToken);
            result = ApplyInvocationFence(result, identity);

            var response = await CreateResolveTenantResponse(
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
            _telemetry.RecordResolveTenant(activity, outcome, started);
        }
    }

    private static ResolveTenantResult ApplyInvocationFence(
        ResolveTenantResult result,
        TenantRequestIdentity identity)
    {
        if (result is ResolveTenantResult.Found found
            && identity.Invocation?.TenantId is { } tenantId
            && found.Resolution.TenantId != tenantId)
        {
            return new ResolveTenantResult.NotFound();
        }

        return result;
    }

    private static RpcException Unavailable() =>
        new(new Status(
            StatusCode.Unavailable,
            "Tenant persistence is unavailable"));

    private static string MapOutcome(StatusCode statusCode) =>
        statusCode switch
        {
            StatusCode.InvalidArgument => "invalid_argument",
            StatusCode.NotFound => "not_found",
            StatusCode.Unauthenticated => "unauthenticated",
            StatusCode.PermissionDenied => "permission_denied",
            StatusCode.FailedPrecondition => "failed_precondition",
            StatusCode.AlreadyExists => "already_exists",
            StatusCode.Aborted => "aborted",
            StatusCode.Cancelled => "cancelled",
            StatusCode.DeadlineExceeded => "deadline_exceeded",
            StatusCode.Unavailable => "unavailable",
            _ => "internal_error"
        };
}
