using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Workloads;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildInterfaceService(
        PlacementId placementId,
        WorkloadRecord workload,
        AdmittedInterface admittedInterface,
        string namespaceName,
        string serviceName,
        string selector,
        int edgeIndex) =>
        BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "Service");
            WriteMetadata(
                writer,
                serviceName,
                namespaceName,
                WorkloadAnnotations(placementId, workload.Id));
            writer.WriteStartObject("spec");
            writer.WriteStartObject("selector");
            writer.WriteString(
                "execution.ctlflow.io/workload",
                selector);
            writer.WriteEndObject();
            writer.WriteStartArray("ports");
            writer.WriteStartObject();
            writer.WriteString("name", "traffic");
            writer.WriteNumber("port", admittedInterface.Port);
            writer.WriteNumber(
                "targetPort",
                admittedInterface.ExposureId is null
                    ? admittedInterface.Port
                    : 10_000 + edgeIndex);
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
}
