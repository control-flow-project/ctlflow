using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildEdgedTrustConfigMap(
        PlacementId placementId,
        WorkloadId workloadId,
        string namespaceName,
        string configMapName,
        string identityCertificateAuthority) =>
        BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "ConfigMap");
            WriteMetadata(
                writer,
                configMapName,
                namespaceName,
                WorkloadAnnotations(placementId, workloadId));
            writer.WriteStartObject("data");
            writer.WriteString(
                "identityd-ca.crt",
                identityCertificateAuthority);
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
}
