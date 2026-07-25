using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.Lifecycles;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.LifecycleResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Security.TenantRequestAuthentication;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ListLifecycleStepsResponse> ListLifecycleSteps(
        ListLifecycleStepsRequest request,
        ServerCallContext context)
    {
        using var activity = _telemetry.StartGrpcOperation(
            "ListLifecycleSteps",
            context.RequestHeaders);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var currentTime = DateTimeOffset.UtcNow;
            var identity = await AuthenticateTenantRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                _settings.LifecycleOwners.All,
                currentTime,
                context.CancellationToken);
            var pageSize = await PageSize.Parse(
                request.PageSize == 0
                    ? null
                    : checked((int)request.PageSize),
                context.CancellationToken);
            var pageToken = await PageToken.ParseOptional(
                request.PageToken,
                context.CancellationToken);
            var actor = await RequestActor.Parse(
                identity.ImmediateCaller.Value,
                context.CancellationToken);
            var stepKey = _settings.LifecycleOwners.ResolveStepKey(
                identity.ImmediateCaller);
            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var result = await
                CtlFlow.Tenancy.Tenantd.Db.Lifecycles.Lifecycles
                    .ListLifecycleSteps(
                _databaseContexts,
                stepKey,
                actor,
                pageSize,
                pageToken,
                _settings.PageCursorLifetime,
                UtcInstant.FromClock(currentTime),
                context.CancellationToken);
            if (result is ListLifecycleStepsResult.ExpiredPageToken)
            {
                throw new RpcException(new Status(
                    StatusCode.FailedPrecondition,
                    "Page token is expired"));
            }

            var page = ((ListLifecycleStepsResult.Page)result).Value;
            var response = new ListLifecycleStepsResponse
            {
                DeliveryRevision =
                    checked((ulong)page.DeliveryRevision.Value),
                NextPageToken = page.NextPageToken?.Value ?? string.Empty
            };
            response.Steps.AddRange(
                page.Steps.Select(CreateLifecycleStep));
            outcome = "ok";
            return response;
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or OverflowException)
        {
            outcome = "invalid_argument";
            throw new RpcException(new Status(
                StatusCode.InvalidArgument,
                "Lifecycle page request is invalid"));
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
                "ListLifecycleSteps",
                outcome,
                started);
        }
    }
}
