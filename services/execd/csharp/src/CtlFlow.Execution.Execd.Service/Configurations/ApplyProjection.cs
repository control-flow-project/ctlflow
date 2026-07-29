using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using Google.Protobuf;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Dependencies.DependencyAuthentication;
using static CtlFlow.Execution.Execd.Service.Grpc.GrpcStatuses;
using DomainConfigTargetReference =
    CtlFlow.Execution.Execd.Domain.Configuration.ConfigTargetReference;
using WireProjectionTarget =
    CtlFlow.Configuration.V1.ProjectionTarget;

namespace CtlFlow.Execution.Execd.Service.Configurations;

internal static partial class ConfigurationProjection
{
    internal static async Task<ResolvedConfigTarget> ApplyProjection(
        ConfigurationService.ConfigurationServiceClient client,
        ConfigurationSettings settings,
        ExecdTelemetry telemetry,
        PlacementId placementId,
        PlacementTarget target,
        WorkloadId workloadId,
        DomainConfigTargetReference requested,
        CancellationToken cancellation)
    {
        var token = await ReadWorkloadToken(
            settings.WorkloadTokenFilePath,
            cancellation);
        var request = new ApplyProjectionRequest
        {
            Target = CreateTarget(requested),
            Binding = new ConsumerBinding
            {
                Placement = CreatePlacementBinding(
                    placementId,
                    target),
                ConsumerId = workloadId.Value,
                Purpose = requested.Purpose.Value
            }
        };
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartDependencyCall(
            "ctlflow.configuration.v1.ConfigurationService",
            "ApplyProjection");
        var outcome = "UNAVAILABLE";
        try
        {
            var response = await client.ApplyProjectionAsync(
                request,
                CreateDependencyHeaders(token),
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            ValidateProjection(response, request);
            outcome = "OK";
            return new ResolvedConfigTarget(
                requested,
                ProjectionId.Parse(response.ProjectionId),
                Revision.Parse(response.ProjectionRevision));
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
            throw exception.StatusCode switch
            {
                StatusCode.NotFound => new ExecutionException(
                    ExecutionError.NotFound,
                    "Configuration target was not found"),
                StatusCode.FailedPrecondition =>
                    new ExecutionException(
                        ExecutionError.FailedPrecondition,
                        "Configuration projection is not admitted"),
                _ => new ExecutionException(
                    ExecutionError.Unavailable,
                    "Configd is unavailable")
            };
        }
        catch (ArgumentException)
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Configd returned an invalid projection");
        }
        finally
        {
            telemetry.RecordDependencyCall(
                activity,
                "ApplyProjection",
                outcome,
                started);
        }
    }

    private static WireProjectionTarget CreateTarget(
        DomainConfigTargetReference target) =>
        target switch
        {
            DomainConfigTargetReference.Configuration item =>
                new WireProjectionTarget
                {
                    Configuration =
                        new ConfigurationProjectionTarget
                        {
                            ConfigurationId =
                                item.ConfigurationId.Value,
                            ConfigurationVersionId =
                                item.ConfigurationVersionId.Value
                        }
                },
            DomainConfigTargetReference.Secret item =>
                new WireProjectionTarget
                {
                    Secret = new SecretProjectionTarget
                    {
                        SecretId = item.SecretId.Value,
                        SecretVersionId =
                            item.SecretVersionId.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Config target is invalid")
        };

    private static PlacementBinding CreatePlacementBinding(
        PlacementId placementId,
        PlacementTarget target)
    {
        var binding = new PlacementBinding
        {
            PlacementId = placementId.Value
        };
        switch (target)
        {
            case PlacementTarget.Global:
                binding.Global = new GlobalPlacementScope();
                break;
            case PlacementTarget.Tenant tenant:
                binding.Tenant = new TenantPlacementScope
                {
                    TenantId = tenant.TenantId.Value
                };
                break;
            case PlacementTarget.Workspace workspace:
                binding.Workspace = new WorkspacePlacementScope
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                };
                break;
            case PlacementTarget.User user:
                binding.User = new UserPlacementScope
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId =
                        user.AccountPrincipalId.Value
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Placement target is invalid");
        }

        return binding;
    }

    private static void ValidateProjection(
        Projection response,
        ApplyProjectionRequest request)
    {
        if (response.Target is null
            || response.Binding is null
            || response.ProjectionRevision is 0
            || response.Target.ToByteString()
                != request.Target.ToByteString()
            || response.Binding.ToByteString()
                != request.Binding.ToByteString())
        {
            throw new ArgumentException(
                "Projection response is invalid");
        }
    }
}
