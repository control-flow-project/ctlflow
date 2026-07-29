using System.Data.Common;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Service.Auditing;
using CtlFlow.Execution.Execd.Service.Authorization;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Telemetry;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed class ExecdInterceptor(
    ExecdTelemetry telemetry,
    ILogger<ExecdInterceptor> logger)
    : Interceptor
{
    private static readonly TimeSpan DeadlineClassificationTolerance =
        TimeSpan.FromMilliseconds(100);
    private static readonly Action<
        ILogger,
        string,
        string,
        string,
        int,
        Exception?> LogOperationFailure =
        LoggerMessage.Define<string, string, string, int>(
            LogLevel.Error,
            new EventId(11, "ExecdOperationFailed"),
            "{Operation} failed with {FailureKind}; "
            + "cause {CauseKind} ({CauseCode})");

    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        var operation = GetOperationName(context.Method);
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
            outcome = GetCanonicalStatusName(exception.StatusCode);
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
        catch (CallerNotAdmittedException)
        {
            outcome = "PERMISSION_DENIED";
            throw CreateRpcException(StatusCode.PermissionDenied);
        }
        catch (CapabilityDeniedException)
        {
            outcome = "PERMISSION_DENIED";
            throw CreateRpcException(StatusCode.PermissionDenied);
        }
        catch (AuthorizationTargetNotFoundException)
        {
            outcome = "NOT_FOUND";
            throw CreateRpcException(StatusCode.NotFound);
        }
        catch (ExecutionException exception)
        {
            var status = MapExecutionError(exception.Error);
            outcome = GetCanonicalStatusName(status);
            throw CreateRpcException(status);
        }
        catch (ArgumentException)
        {
            outcome = "INVALID_ARGUMENT";
            throw CreateRpcException(StatusCode.InvalidArgument);
        }
        catch (OverflowException)
        {
            outcome = "INVALID_ARGUMENT";
            throw CreateRpcException(StatusCode.InvalidArgument);
        }
        catch (Exception) when (
            context.CancellationToken.IsCancellationRequested)
        {
            var status = GetCancellationStatus(context);
            outcome = GetCanonicalStatusName(status);
            throw CreateRpcException(status);
        }
        catch (OperationCanceledException)
        {
            var status = GetCancellationStatus(context);
            outcome = GetCanonicalStatusName(status);
            throw CreateRpcException(status);
        }
        catch (Exception exception) when (
            exception is AuditUnavailableException
                or PolicyUnavailableException
                or KubernetesUnavailableException
                or DbException
                or DbUpdateException
                or IOException
                or InvalidOperationException)
        {
            outcome = "UNAVAILABLE";
            var cause = exception.InnerException as DbException
                ?? exception as DbException;
            LogOperationFailure(
                logger,
                operation,
                exception.GetType().Name,
                cause?.GetType().Name ?? "none",
                cause?.ErrorCode ?? 0,
                null);
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
        new(new Status(status, GetCanonicalStatusName(status)));

    private static StatusCode GetCancellationStatus(
        ServerCallContext context) =>
        context.Deadline != DateTime.MaxValue
        && context.Deadline <= DateTime.UtcNow.Add(
            DeadlineClassificationTolerance)
            ? StatusCode.DeadlineExceeded
            : StatusCode.Cancelled;

    private static StatusCode MapExecutionError(
        ExecutionError error) =>
        error switch
        {
            ExecutionError.InvalidArgument =>
                StatusCode.InvalidArgument,
            ExecutionError.NotFound => StatusCode.NotFound,
            ExecutionError.AlreadyExists =>
                StatusCode.AlreadyExists,
            ExecutionError.FailedPrecondition =>
                StatusCode.FailedPrecondition,
            ExecutionError.Aborted => StatusCode.Aborted,
            ExecutionError.ResourceExhausted =>
                StatusCode.ResourceExhausted,
            ExecutionError.Unavailable =>
                StatusCode.Unavailable,
            _ => StatusCode.Internal
        };

    private static string GetOperationName(string method)
    {
        var separator = method.LastIndexOf('/');
        return separator >= 0 && separator < method.Length - 1
            ? method[(separator + 1)..]
            : "Unknown";
    }
}
