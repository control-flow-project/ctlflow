using System.Data.Common;
using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
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
    private static readonly TimeSpan LifecycleWatchPollInterval =
        TimeSpan.FromMilliseconds(50);

    public override async Task WatchLifecycleSteps(
        WatchLifecycleStepsRequest request,
        IServerStreamWriter<LifecycleStepEvent> responseStream,
        ServerCallContext context)
    {
        using var activity = _telemetry.StartGrpcOperation(
            "WatchLifecycleSteps",
            context.RequestHeaders);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var startedAt = DateTimeOffset.UtcNow;
            var identity = await AuthenticateTenantRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                _settings.LifecycleOwners.All,
                startedAt,
                context.CancellationToken);
            var after = LifecycleDeliveryCursor.Parse(
                checked((long)request.AfterDeliverySequence));
            var stepKey = _settings.LifecycleOwners.ResolveStepKey(
                identity.ImmediateCaller);
            if (await VerifyMigrationLedger(
                    _databaseContexts,
                    context.CancellationToken)
                != SchemaCompatibility.Compatible)
            {
                throw Unavailable();
            }

            var stopAt = startedAt + _settings.WatchLifetime.Value;
            while (DateTimeOffset.UtcNow < stopAt)
            {
                var read = await ReadLifecycleStepEvents(
                    _databaseContexts,
                    stepKey,
                    after,
                    context.CancellationToken);
                if (read is LifecycleWatchReadResult.InvalidCursor)
                {
                    throw new RpcException(new Status(
                        StatusCode.InvalidArgument,
                        "Lifecycle watch cursor is invalid"));
                }

                var batch = (LifecycleWatchReadResult.Batch)read;
                foreach (var item in batch.Items)
                {
                    await responseStream.WriteAsync(
                        new LifecycleStepEvent
                        {
                            DeliverySequence = checked(
                                (ulong)item.DeliverySequence.Value),
                            Step = CreateLifecycleStep(item)
                        },
                        context.CancellationToken);
                    after = LifecycleDeliveryCursor.FromStorage(
                        item.DeliverySequence.Value);
                }

                if (batch.Items.Count == 0)
                {
                    after = batch.Current;
                    await Task.Delay(
                        LifecycleWatchPollInterval,
                        context.CancellationToken);
                }
            }

            outcome = "ok";
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or OverflowException)
        {
            outcome = "invalid_argument";
            throw new RpcException(new Status(
                StatusCode.InvalidArgument,
                "Lifecycle watch request is invalid"));
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
                "WatchLifecycleSteps",
                outcome,
                started);
        }
    }
}
