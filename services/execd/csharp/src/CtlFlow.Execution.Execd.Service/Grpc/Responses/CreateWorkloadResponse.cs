using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.V1;
using Google.Protobuf.WellKnownTypes;
using WireAdmittedPackageComponent =
    CtlFlow.Execution.V1.AdmittedPackageComponent;
using WireWorkload = CtlFlow.Execution.V1.Workload;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static ValueTask<WireWorkload> CreateWorkloadResponse(
        WorkloadRecord workload,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var response = new WireWorkload
        {
            WorkloadId = workload.Id.Value,
            PlacementId = workload.PlacementId.Value,
            Declaration =
                CreateWorkloadDeclarationResponse(workload),
            AdmittedPackageComponent =
                new WireAdmittedPackageComponent
                {
                    AppId = workload.AdmittedPackage.AppId.Value,
                    AppRevision = checked(
                        (ulong)workload.AdmittedPackage
                            .AppRevision.Value),
                    PackageId =
                        workload.AdmittedPackage.PackageId.Value,
                    PackageGeneration = checked(
                        (ulong)workload.AdmittedPackage
                            .PackageGeneration.Value),
                    ComponentId =
                        workload.AdmittedPackage.ComponentId.Value
                },
            Revision = checked((ulong)workload.Revision.Value),
            Realization =
                CreateRealizationResponse(workload.Realization),
            CreatedAt = Timestamp.FromDateTimeOffset(
                workload.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(
                workload.UpdatedAt.Value)
        };
        response.Endpoints.AddRange(
            workload.Interfaces.Select(item =>
            {
                var endpoint = new EndpointStatus
                {
                    InterfaceId = item.InterfaceId.Value,
                    Ready = item.Ready
                };
                if (item.Host is not null)
                {
                    endpoint.Host = item.Host.Value;
                }

                return endpoint;
            }));
        return ValueTask.FromResult(response);
    }
}
