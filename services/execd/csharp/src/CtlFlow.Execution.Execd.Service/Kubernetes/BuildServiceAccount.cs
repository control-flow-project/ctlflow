using CtlFlow.Execution.Execd.Domain.Identifiers;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildServiceAccount(
        PlacementId placementId,
        WorkloadId workloadId,
        string namespaceName,
        string accountName) =>
        BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "ServiceAccount");
            WriteMetadata(
                writer,
                accountName,
                namespaceName,
                WorkloadAnnotations(placementId, workloadId));
            writer.WriteBoolean(
                "automountServiceAccountToken",
                false);
            writer.WriteEndObject();
        });
}
