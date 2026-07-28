using System.Data.Common;
using CtlFlow.Policy.Policyd.Service.Catalog;
using CtlFlow.Policy.Policyd.Service.Identity;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Policy.Policyd.Service.Grpc.GrpcStatuses;
using static CtlFlow.Policy.Policyd.Service.Grpc.PolicyGrpcErrors;

namespace CtlFlow.Policy.Policyd.Service.Grpc;

internal sealed class PolicydInterceptor(PolicydTelemetry telemetry)
    : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartGrpcOperation(
            context.RequestHeaders);
        var outcome = "INTERNAL";
        string? decision = null;
        try
        {
            var response = await continuation(request, context);
            outcome = "OK";
            decision = ReadDecision(response);
            return response;
        }
        catch (RpcException exception)
        {
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw CreateExpectedRpcException(exception.StatusCode);
        }
        catch (TokenValidationException)
        {
            outcome = "UNAUTHENTICATED";
            throw CreateExpectedRpcException(StatusCode.Unauthenticated);
        }
        catch (TokenKeySourceException)
        {
            outcome = "UNAVAILABLE";
            throw CreateExpectedRpcException(StatusCode.Unavailable);
        }
        catch (CallerNotAdmittedException)
        {
            outcome = "PERMISSION_DENIED";
            throw CreateExpectedRpcException(StatusCode.PermissionDenied);
        }
        catch (TargetNotFoundException)
        {
            outcome = "NOT_FOUND";
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or OverflowException)
        {
            outcome = "INVALID_ARGUMENT";
            throw CreateExpectedRpcException(StatusCode.InvalidArgument);
        }
        catch (Exception) when (
            context.CancellationToken.IsCancellationRequested)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = GetCanonicalStatusName(status);
            throw CreateExpectedRpcException(status);
        }
        catch (OperationCanceledException)
        {
            var status = context.Deadline <= DateTime.UtcNow
                ? StatusCode.DeadlineExceeded
                : StatusCode.Cancelled;
            outcome = GetCanonicalStatusName(status);
            throw CreateExpectedRpcException(status);
        }
        catch (Exception exception) when (
            exception is CatalogUnavailableException
                or IdentityUnavailableException
                or DbException
                or DbUpdateException
                or IOException
                or InvalidOperationException)
        {
            outcome = "UNAVAILABLE";
            throw CreateExpectedRpcException(StatusCode.Unavailable);
        }
        finally
        {
            telemetry.RecordGrpcOperation(
                activity,
                outcome,
                decision,
                started);
        }
    }

    private static string? ReadDecision<TResponse>(TResponse response) =>
        response is CheckAccessResponse access
            ? access.Decision switch
            {
                AccessDecision.Allow => "allow",
                AccessDecision.Deny => "deny",
                _ => null
            }
            : null;
}
