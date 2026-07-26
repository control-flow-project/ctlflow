using System.Data.Common;
using CtlFlow.Tenancy.Tenantd.Service.Auditing;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed class TenantdInterceptor(TenantdTelemetry telemetry)
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
        var outcome = "internal_error";
        try
        {
            var response = await continuation(request, context);
            outcome = "ok";
            return response;
        }
        catch (RpcException exception)
        {
            outcome = exception.StatusCode.ToString().ToLowerInvariant();
            throw;
        }
        catch (TokenValidationException)
        {
            outcome = "unauthenticated";
            throw CreateRpcException(StatusCode.Unauthenticated);
        }
        catch (TokenKeySourceException)
        {
            outcome = "unavailable";
            throw CreateRpcException(StatusCode.Unavailable);
        }
        catch (CallerNotAdmittedException)
        {
            outcome = "permission_denied";
            throw CreateRpcException(StatusCode.PermissionDenied);
        }
        catch (ArgumentException)
        {
            outcome = "invalid_argument";
            throw CreateRpcException(StatusCode.InvalidArgument);
        }
        catch (OverflowException)
        {
            outcome = "invalid_argument";
            throw CreateRpcException(StatusCode.InvalidArgument);
        }
        catch (OperationCanceledException)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = status.ToString().ToLowerInvariant();
            throw CreateRpcException(status);
        }
        catch (Exception exception) when (
            exception is AuditUnavailableException
                or DbException
                or DbUpdateException
                or IOException
                or InvalidOperationException)
        {
            outcome = "unavailable";
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

    private static string GetOperationName(string method)
    {
        var separator = method.LastIndexOf('/');
        return separator >= 0 && separator < method.Length - 1
            ? method[(separator + 1)..]
            : "Unknown";
    }
}
