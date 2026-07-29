using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.V1;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using DomainExecutionResources =
    CtlFlow.Execution.Execd.Domain.Workloads.ExecutionResources;
using DomainPersistentStorage =
    CtlFlow.Execution.Execd.Domain.Workloads.PersistentStorage;
using WireDependencySelection =
    CtlFlow.Execution.V1.DependencySelection;
using DomainPackageComponentReference =
    CtlFlow.Execution.Execd.Domain.Workloads.PackageComponentReference;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static ValueTask<WorkloadRequest> CreateWorkloadRequest(
        DeclareWorkloadRequest request,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var declaration = request.Declaration
            ?? throw new ArgumentException(
                "declaration is required");
        var component = declaration.PackageComponent
            ?? throw new ArgumentException(
                "package_component is required");
        var resources = declaration.Resources
            ?? throw new ArgumentException("resources is required");

        var targets = declaration.ConfigdTargets
            .Select(ParseConfigTarget)
            .ToArray();
        var dependencies = declaration.Dependencies
            .Select(ParseDependency)
            .ToArray();
        var storage = declaration.PersistentStorage
            .Select(item => new DomainPersistentStorage(
                StorageId.Parse(item.StorageId),
                MountPath.Parse(item.MountPath),
                ParsePositiveLong(
                    item.CapacityBytes,
                    "capacity_bytes")))
            .ToArray();
        WorkloadBehavior behavior = declaration.BehaviorCase switch
        {
            WorkloadDeclaration.BehaviorOneofCase.Continuous =>
                new WorkloadBehavior.Continuous(
                    ParsePositiveInt(
                        declaration.Continuous.Replicas,
                        "replicas"),
                    declaration.Continuous.InterfaceIds
                        .Select(InterfaceId.Parse)
                        .ToArray()),
            WorkloadDeclaration.BehaviorOneofCase.Finite =>
                new WorkloadBehavior.Finite(
                    declaration.Finite.HasActorPrincipalId
                        ? PrincipalId.Parse(
                            declaration.Finite.ActorPrincipalId)
                        : null,
                    ParsePositiveLong(
                        declaration.Finite.RunDurationSeconds,
                        "run_duration_seconds"),
                    ParsePositiveInt(
                        declaration.Finite.MaxAttempts,
                        "max_attempts")),
            _ => throw new ArgumentException(
                "declaration behavior is required")
        };

        return ValueTask.FromResult(new WorkloadRequest(
            WorkloadId.Parse(request.WorkloadId),
            PlacementId.Parse(request.PlacementId),
            ParseDesiredState(declaration.DesiredState),
            new DomainPackageComponentReference(
                AppId.Parse(component.AppId),
                ComponentId.Parse(component.ComponentId)),
            DomainExecutionResources.Create(
                resources.CpuMillis,
                resources.MemoryBytes),
            targets,
            dependencies,
            storage,
            behavior,
            request.HasExpectedRevision
                ? Revision.Parse(request.ExpectedRevision)
                : null));
    }

    private static RequestedDependencySelection ParseDependency(
        WireDependencySelection item)
    {
        var parameters = item.ProvisioningParameters
            .Select(parameter =>
                new RequestedProvisioningParameter(
                    ParameterName.Parse(parameter.ParameterName),
                    ParseConfigTarget(parameter.Target)))
            .ToArray();
        return new RequestedDependencySelection(
            ComponentId.Parse(item.ComponentId),
            DependencyName.Parse(item.DependencyName),
            item.HasDependencyId
                ? DependencyId.Parse(item.DependencyId)
                : null,
            parameters);
    }

    private static int ParsePositiveInt(uint value, string name) =>
        value is > 0 and <= int.MaxValue
            ? (int)value
            : throw new ArgumentException($"{name} is invalid");

    private static long ParsePositiveLong(ulong value, string name) =>
        value is > 0 and <= long.MaxValue
            ? (long)value
            : throw new ArgumentException($"{name} is invalid");
}
