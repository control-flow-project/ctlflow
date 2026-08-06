using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Naming;

public static partial class NativeNames
{
    // Admission derives and retains the canonical subject before any
    // Kubernetes object exists. Realization consumes that retained identity.
    public static string CreateServiceAccountSubject(
        PlacementId placementId,
        WorkloadId workloadId) =>
        "system:serviceaccount:"
        + CreatePlacementNamespace(placementId)
        + ":"
        + CreateWorkloadServiceAccount(workloadId);

    private static string CreateWorkloadServiceAccount(WorkloadId workloadId) =>
        $"wld-{CreateNativeToken(
            "ctlflow.execution.v1.WorkloadServiceAccount",
            workloadId.Value)}";
}
