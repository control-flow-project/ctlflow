using System.Globalization;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Workloads;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildPersistentVolumeClaim(
        PlacementId placementId,
        AppId appId,
        PersistentStorage storage,
        string namespaceName,
        string claimName) =>
        BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "PersistentVolumeClaim");
            WriteMetadata(
                writer,
                claimName,
                namespaceName,
                AppStorageAnnotations(
                    placementId,
                    appId,
                    storage.StorageId));
            writer.WriteStartObject("spec");
            writer.WriteStartArray("accessModes");
            writer.WriteStringValue("ReadWriteOnce");
            writer.WriteEndArray();
            writer.WriteStartObject("resources");
            writer.WriteStartObject("requests");
            writer.WriteString(
                "storage",
                storage.CapacityBytes.ToString(
                    CultureInfo.InvariantCulture));
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
}
