using CtlFlow.Execution.Execd.Domain.Identifiers;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildNamespace(
        PlacementId placementId,
        string namespaceName) =>
        BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "Namespace");
            WriteMetadata(
                writer,
                namespaceName,
                null,
                PlacementAnnotations(placementId));
            writer.WriteEndObject();
        });
}
