using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditCorrelations;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.LifecycleRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.LifecycleResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Security.TenantRequestAuthentication;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<AcknowledgeLifecycleStepResponse>
        AcknowledgeLifecycleStep(
            AcknowledgeLifecycleStepRequest request,
            ServerCallContext context)
    {
        using var activity = _telemetry.StartGrpcOperation(
            "AcknowledgeLifecycleStep",
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
            var actor = await RequestActor.Parse(
                identity.ImmediateCaller.Value,
                context.CancellationToken);
            var command = await ParseAcknowledgeLifecycleStep(
                request,
                actor,
                context.CancellationToken);
            var ownedStep = _settings.LifecycleOwners.ResolveStepKey(
                identity.ImmediateCaller);
            if (command.StepKey != ownedStep)
            {
                throw new CallerNotAdmittedException();
            }

            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var result = await
                CtlFlow.Tenancy.Tenantd.Db.Lifecycles.Lifecycles
                    .AcknowledgeLifecycleStep(
                        _databaseContexts,
                        command,
                        await CreateAuditCorrelation(
                            activity,
                            context.CancellationToken),
                        UtcInstant.FromClock(currentTime),
                        context.CancellationToken);
            var response = await CreateAcknowledgeLifecycleStepResponse(
                result,
                context.CancellationToken);
            outcome = "ok";
            return response;
        }
        catch (Exception exception) when (
            exception is ArgumentException or OverflowException)
        {
            outcome = "invalid_argument";
            throw new RpcException(new Status(
                StatusCode.InvalidArgument,
                "Lifecycle acknowledgement is invalid"));
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
        catch (Exception) when (
            context.CancellationToken.IsCancellationRequested)
        {
            var deadlineExceeded = context.Deadline <= DateTimeOffset.UtcNow;
            outcome = deadlineExceeded
                ? "deadline_exceeded"
                : "cancelled";
            throw new RpcException(new Status(
                deadlineExceeded
                    ? StatusCode.DeadlineExceeded
                    : StatusCode.Cancelled,
                "Request was cancelled"));
        }
        catch (DbUpdateConcurrencyException)
        {
            outcome = "aborted";
            throw new RpcException(new Status(
                StatusCode.Aborted,
                "Lifecycle step revision changed"));
        }
        catch (DbUpdateException)
        {
            outcome = "unavailable";
            throw Unavailable();
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
                "AcknowledgeLifecycleStep",
                outcome,
                started);
        }
    }
}
