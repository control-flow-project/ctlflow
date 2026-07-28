using System.Data.Common;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Service.Auditing;
using CtlFlow.Packages.Pkgd.Service.Authorization;
using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Telemetry;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Packages.Pkgd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed class PkgdInterceptor(PkgdTelemetry telemetry)
    : Interceptor
{
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
        catch (PackageLimitExceededException)
        {
            outcome = "RESOURCE_EXHAUSTED";
            throw CreateRpcException(StatusCode.ResourceExhausted);
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
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = GetCanonicalStatusName(status);
            throw CreateRpcException(status);
        }
        catch (OperationCanceledException)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = GetCanonicalStatusName(status);
            throw CreateRpcException(status);
        }
        catch (Exception exception) when (
            exception is AuditUnavailableException
                or PolicyUnavailableException
                or DbException
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
        new(new Status(status, GetCanonicalStatusName(status)));

    private static string GetOperationName(string method)
    {
        var separator = method.LastIndexOf('/');
        return separator >= 0 && separator < method.Length - 1
            ? method[(separator + 1)..]
            : "Unknown";
    }
}
