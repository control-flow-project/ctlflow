using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.V1;
using DomainDependencySelection =
    CtlFlow.Execution.Execd.Domain.Workloads.DependencySelection;
using DomainExecutionResources =
    CtlFlow.Execution.Execd.Domain.Workloads.ExecutionResources;
using DomainPersistentStorage =
    CtlFlow.Execution.Execd.Domain.Workloads.PersistentStorage;
using WireExecutionResources =
    CtlFlow.Execution.V1.ExecutionResources;
using WireDependencySelection =
    CtlFlow.Execution.V1.DependencySelection;
using WirePersistentStorage =
    CtlFlow.Execution.V1.PersistentStorage;
using WirePackageComponentReference =
    CtlFlow.Execution.V1.PackageComponentReference;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static WorkloadDeclaration CreateWorkloadDeclarationResponse(
        WorkloadRecord workload)
    {
        var response = new WorkloadDeclaration
        {
            DesiredState = MapState(workload.DesiredState),
            PackageComponent = new WirePackageComponentReference
            {
                AppId = workload.PackageComponent.AppId.Value,
                ComponentId =
                    workload.PackageComponent.ComponentId.Value
            },
            Resources = CreateResourcesResponse(workload.Resources)
        };
        response.ConfigdTargets.AddRange(
            workload.ConfigTargets.Select(item =>
                CreateConfigTargetResponse(item.Target)));
        response.Dependencies.AddRange(
            workload.Dependencies.Select(item =>
                CreateDependencyResponse(item.Selection)));
        response.PersistentStorage.AddRange(
            workload.Storage.Select(CreateStorageResponse));
        switch (workload.Behavior)
        {
            case WorkloadBehavior.Continuous continuous:
                response.Continuous = new ContinuousWorkload
                {
                    Replicas = checked((uint)continuous.Replicas)
                };
                response.Continuous.InterfaceIds.AddRange(
                    continuous.InterfaceIds.Select(item => item.Value));
                break;
            case WorkloadBehavior.Finite finite:
                response.Finite = new FiniteWorkload
                {
                    RunDurationSeconds = checked(
                        (ulong)finite.RunDurationSeconds),
                    MaxAttempts = checked((uint)finite.MaxAttempts)
                };
                if (finite.ActorPrincipalId is not null)
                {
                    response.Finite.ActorPrincipalId =
                        finite.ActorPrincipalId.Value;
                }

                break;
            default:
                throw new InvalidOperationException(
                    "Workload behavior is invalid");
        }

        return response;
    }

    internal static WireExecutionResources CreateResourcesResponse(
        DomainExecutionResources resources) =>
        new()
        {
            CpuMillis = checked((uint)resources.CpuMillis),
            MemoryBytes = checked((ulong)resources.MemoryBytes)
        };

    internal static WireDependencySelection CreateDependencyResponse(
        DomainDependencySelection selection)
    {
        var response = new WireDependencySelection
        {
            ComponentId = selection.ComponentId.Value,
            DependencyName = selection.Name.Value
        };
        if (selection.DependencyId is not null)
        {
            response.DependencyId = selection.DependencyId.Value;
        }

        response.ProvisioningParameters.AddRange(
            selection.Parameters.Select(item =>
                new ProvisioningParameterReference
                {
                    ParameterName = item.Name.Value,
                    Target = CreateConfigTargetResponse(
                        item.Target.Target)
                }));
        return response;
    }

    internal static WirePersistentStorage CreateStorageResponse(
        DomainPersistentStorage storage) =>
        new()
        {
            StorageId = storage.StorageId.Value,
            MountPath = storage.MountPath.Value,
            CapacityBytes = checked((ulong)storage.CapacityBytes)
        };
}
