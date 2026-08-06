using CtlFlow.Execution.V1;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Workloads;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    // Confirms one product operation for the authenticated Workload subject.
    //
    // The subject is one Policyd derived from a workload token it validated;
    // Execd confirms the operation against its retained admission snapshot.
    // Execd returns NOT_FOUND for an unknown subject, an inactive Workload or
    // Placement ancestor, and an unadmitted operation alike, so the caller
    // learns nothing beyond "not authorized".
    private static async Task<ProductOperationBinding>
        ResolveWorkloadOperationBinding(
            ExecutionService.ExecutionServiceClient executionClient,
            ExecutionSettings settings,
            string workloadTokenFilePath,
            PolicydTelemetry telemetry,
            KubernetesServiceAccountSubject caller,
            OperationToken operation,
            CancellationToken cancellation)
    {
        using var activity = telemetry.StartExecutionCall(
            "ResolveWorkloadOperationBinding");
        // The call carries Policyd's own workload token and trace context and,
        // per contract, no invocation JWT.
        string token;
        try
        {
            token = (await File.ReadAllTextAsync(
                workloadTokenFilePath,
                cancellation)).Trim();
            if (token.Length is < 1 or > 16_384)
            {
                throw new InvalidDataException(
                    "The execution workload token is invalid");
            }
        }
        catch (OperationCanceledException)
        {
            // Cancellation and deadlines are outcomes too; the span never
            // ends without one.
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                cancellation.IsCancellationRequested
                    ? "CANCELLED"
                    : "DEADLINE_EXCEEDED");
            throw;
        }
        catch (Exception failure) when (
            failure is InvalidDataException
                or IOException
                or UnauthorizedAccessException)
        {
            // Every exit from this call records the dependency outcome,
            // including the ones that never reach the wire.
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                "UNAVAILABLE");
            throw new ExecutionUnavailableException(failure);
        }
        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" }
        };
        PolicydTelemetry.AddTraceContext(headers, activity);
        ResolveWorkloadOperationBindingResponse response;
        try
        {
            response = await executionClient
                .ResolveWorkloadOperationBindingAsync(
                    new ResolveWorkloadOperationBindingRequest
                    {
                        ServiceAccountSubject = caller.Value,
                        Operation = operation.Value
                    },
                    CreateExecutionCallOptions(
                        settings,
                        headers,
                        cancellation));
        }
        catch (RpcException failure)
            when (failure.StatusCode == StatusCode.NotFound)
        {
            // No active admitted binding: a product caller denial rather than
            // an exposure of which condition failed.
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                Grpc.GrpcStatuses.GetCanonicalStatusName(
                    StatusCode.NotFound));
            throw new CallerNotAdmittedException();
        }
        catch (RpcException failure)
            when (failure.StatusCode is StatusCode.Cancelled
                or StatusCode.DeadlineExceeded)
        {
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                Grpc.GrpcStatuses.GetCanonicalStatusName(
                    failure.StatusCode));
            throw;
        }
        catch (RpcException failure)
        {
            // Any other dependency outcome fails closed as unavailable.
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                Grpc.GrpcStatuses.GetCanonicalStatusName(
                    failure.StatusCode));
            throw new ExecutionUnavailableException(failure);
        }
        catch (OperationCanceledException)
        {
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                cancellation.IsCancellationRequested
                    ? "CANCELLED"
                    : "DEADLINE_EXCEEDED");
            throw;
        }

        // Boundary validation before any fence or policy step; a malformed
        // dependency response fails closed as unavailable.
        try
        {
            var binding = ValidateBindingResponse(response);
            PolicydTelemetry.RecordDependencyOutcome(activity, "OK");
            return binding;
        }
        catch (InvalidDataException failure)
        {
            PolicydTelemetry.RecordDependencyOutcome(
                activity,
                "UNAVAILABLE");
            throw new ExecutionUnavailableException(failure);
        }
    }

    private static CallOptions CreateExecutionCallOptions(
        ExecutionSettings settings,
        Metadata headers,
        CancellationToken cancellation) =>
        new(
            headers: headers,
            deadline: DateTime.UtcNow.Add(settings.CallTimeout),
            cancellationToken: cancellation);
}
