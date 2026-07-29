using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class ExecutionOwnership
{
    internal static IReadOnlyDictionary<string, string>
        PlacementAnnotations(PlacementId placementId) =>
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["execution.ctlflow.io/owner-service"] = "execd",
            ["execution.ctlflow.io/placement-id"] =
                placementId.Value
        };

    internal static IReadOnlyDictionary<string, string>
        WorkloadAnnotations(
            PlacementId placementId,
            WorkloadId workloadId)
    {
        var annotations = new Dictionary<string, string>(
            PlacementAnnotations(placementId),
            StringComparer.Ordinal)
        {
            ["execution.ctlflow.io/workload-id"] =
                workloadId.Value
        };
        return annotations;
    }

    internal static IReadOnlyDictionary<string, string> RunAnnotations(
        PlacementId placementId,
        WorkloadId workloadId,
        RunId runId)
    {
        var annotations = new Dictionary<string, string>(
            WorkloadAnnotations(placementId, workloadId),
            StringComparer.Ordinal)
        {
            ["execution.ctlflow.io/run-id"] = runId.Value
        };
        return annotations;
    }
}
