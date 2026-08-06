using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Service.Configuration;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    // The product runtime trust bundle: the workload-token verification key
    // set and the Identityd/Policyd trust anchors. Nothing here is secret and
    // nothing here grants authority.
    internal static byte[] BuildWorkloadTrustConfigMap(
        PlacementId placementId,
        WorkloadId workloadId,
        string namespaceName,
        string configMapName,
        ProductBootstrapSettings bootstrap) =>
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
                "workload-jwks.json",
                bootstrap.WorkloadVerificationKeySet);
            writer.WriteString(
                "identityd-ca.crt",
                bootstrap.IdentityCertificateAuthority);
            writer.WriteString(
                "policyd-ca.crt",
                bootstrap.PolicyCertificateAuthority);
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
}
