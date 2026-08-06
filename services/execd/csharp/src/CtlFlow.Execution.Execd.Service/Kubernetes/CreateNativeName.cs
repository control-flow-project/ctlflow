using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using DomainNativeNames =
    CtlFlow.Execution.Execd.Domain.Naming.NativeNames;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

public static class NativeNames
{
    // The namespace name is derived by the Domain convention so realization
    // and admission cannot diverge. The Workload ServiceAccount name is never
    // derived here: admission retains the subject and realization parses it.
    public static string PlacementNamespace(PlacementId placementId) =>
        DomainNativeNames.CreatePlacementNamespace(placementId);

    public static string RunJob(RunId runId) =>
        $"run-{CreateNativeToken(
            "ctlflow.execution.v1.RunJob",
            runId.Value)}";

    public static string RunInvocationSecret(RunId runId) =>
        $"inv-{CreateNativeToken(
            "ctlflow.execution.v1.RunInvocationSecret",
            runId.Value)}";

    public static string EdgedTrustConfigMap(WorkloadId workloadId) =>
        $"etr-{CreateNativeToken(
            "ctlflow.execution.v1.EdgedTrustConfigMap",
            workloadId.Value)}";

    public static string WorkloadTrustConfigMap(WorkloadId workloadId) =>
        $"wtr-{CreateNativeToken(
            "ctlflow.execution.v1.WorkloadTrustConfigMap",
            workloadId.Value)}";

    public static string StorageClaim(
        WorkloadId workloadId,
        StorageId storageId) =>
        $"vol-{CreateNativeToken(
            "ctlflow.execution.v1.StorageClaim",
            $"{workloadId.Value}/{storageId.Value}")}";

    public static string InterfaceService(
        WorkloadId workloadId,
        InterfaceId interfaceId) =>
        $"ifc-{CreateNativeToken(
            "ctlflow.execution.v1.InterfaceService",
            $"{workloadId.Value}/{interfaceId.Value}")}";

    public static string ProjectionObject(ProjectionId projectionId) =>
        $"prj-{CreateNativeToken(
            "ctlflow.configuration.v1.ProjectionObject",
            projectionId.Value)}";

    public static string ProjectionMountPath(
        DataKind kind,
        Purpose purpose) =>
        kind switch
        {
            DataKind.Configuration =>
                $"/run/ctlflow/configurations/{purpose.Value}/content",
            DataKind.Secret =>
                $"/run/ctlflow/secrets/{purpose.Value}/content",
            _ => throw new InvalidOperationException("Data kind is invalid")
        };

    private static string CreateNativeToken(string domain, string id) =>
        DomainNativeNames.CreateNativeToken(domain, id);
}
