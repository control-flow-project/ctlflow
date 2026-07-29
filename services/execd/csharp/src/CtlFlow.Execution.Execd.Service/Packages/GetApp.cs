using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Dependencies.DependencyAuthentication;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Execution.Execd.Service.Packages;

internal static partial class PackageAdmission
{
    internal static async Task<App> GetApp(
        PackageService.PackageServiceClient client,
        PackageSettings settings,
        ExecdTelemetry telemetry,
        AppId appId,
        CancellationToken cancellation)
    {
        var token = await ReadWorkloadToken(
            settings.WorkloadTokenFilePath,
            cancellation);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartDependencyCall(
            "ctlflow.packages.v1.PackageService",
            "GetApp");
        var outcome = "UNAVAILABLE";
        try
        {
            var response = await client.GetAppAsync(
                new GetAppRequest
                {
                    AppId = appId.Value
                },
                CreateDependencyHeaders(token),
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            outcome = "OK";
            return response;
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "CANCELLED";
            throw;
        }
        catch (RpcException exception)
        {
            outcome = GetCanonicalStatusName(exception.StatusCode);
            throw exception.StatusCode == StatusCode.NotFound
                ? new ExecutionException(
                    ExecutionError.NotFound,
                    "App was not found")
                : new ExecutionException(
                    ExecutionError.Unavailable,
                    "Pkgd is unavailable");
        }
        finally
        {
            telemetry.RecordDependencyCall(
                activity,
                "GetApp",
                outcome,
                started);
        }
    }
}
