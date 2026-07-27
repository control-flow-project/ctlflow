using System.Data.Common;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Service.Security;
using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using CtlFlow.Audit.Auditd.Service.Telemetry;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Service.Grpc;

internal sealed class AuditdInterceptor(AuditdTelemetry telemetry)
    : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        const string operation = "RecordAuditBatch";
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartGrpcOperation(
            operation,
            context.RequestHeaders);
        var outcome = "INTERNAL";
        try
        {
            var response = await continuation(request, context);
            outcome = "OK";
            return response;
        }
        catch (RpcException exception)
        {
            outcome = ToOutcome(exception.StatusCode);
            throw;
        }
        catch (TokenValidationException)
        {
            outcome = "UNAUTHENTICATED";
            throw CreateRpcException(StatusCode.Unauthenticated);
        }
        catch (TokenKeySourceException)
        {
            outcome = "UNAVAILABLE";
            throw CreateRpcException(StatusCode.Unavailable);
        }
        catch (Exception exception) when (
            exception is CallerNotAdmittedException
                or AuditPermissionException)
        {
            outcome = "PERMISSION_DENIED";
            throw CreateRpcException(StatusCode.PermissionDenied);
        }
        catch (AuditContentConflictException)
        {
            outcome = "ALREADY_EXISTS";
            throw CreateRpcException(StatusCode.AlreadyExists);
        }
        catch (Exception exception) when (
            exception is AuditBatchLimitException
                or AuditCursorExhaustedException)
        {
            outcome = "RESOURCE_EXHAUSTED";
            throw CreateRpcException(StatusCode.ResourceExhausted);
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or OverflowException)
        {
            outcome = "INVALID_ARGUMENT";
            throw CreateRpcException(StatusCode.InvalidArgument);
        }
        catch (OperationCanceledException)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = ToOutcome(status);
            throw CreateRpcException(status);
        }
        catch (Exception) when (
            context.CancellationToken.IsCancellationRequested)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = ToOutcome(status);
            throw CreateRpcException(status);
        }
        catch (Exception exception) when (
            exception is DbException
                or DbUpdateException
                or IOException
                or InvalidOperationException)
        {
            outcome = "UNAVAILABLE";
            throw CreateRpcException(StatusCode.Unavailable);
        }
        finally
        {
            telemetry.RecordGrpcOperation(
                activity,
                operation,
                outcome,
                started);
        }
    }

    private static RpcException CreateRpcException(StatusCode status) =>
        new(new Status(status, status.ToString()));

    private static string ToOutcome(StatusCode status) =>
        status switch
        {
            StatusCode.OK => "OK",
            StatusCode.Cancelled => "CANCELLED",
            StatusCode.Unknown => "UNKNOWN",
            StatusCode.InvalidArgument => "INVALID_ARGUMENT",
            StatusCode.DeadlineExceeded => "DEADLINE_EXCEEDED",
            StatusCode.NotFound => "NOT_FOUND",
            StatusCode.AlreadyExists => "ALREADY_EXISTS",
            StatusCode.PermissionDenied => "PERMISSION_DENIED",
            StatusCode.ResourceExhausted => "RESOURCE_EXHAUSTED",
            StatusCode.FailedPrecondition => "FAILED_PRECONDITION",
            StatusCode.Aborted => "ABORTED",
            StatusCode.OutOfRange => "OUT_OF_RANGE",
            StatusCode.Unimplemented => "UNIMPLEMENTED",
            StatusCode.Internal => "INTERNAL",
            StatusCode.Unavailable => "UNAVAILABLE",
            StatusCode.DataLoss => "DATA_LOSS",
            StatusCode.Unauthenticated => "UNAUTHENTICATED",
            _ => "UNKNOWN"
        };
}
