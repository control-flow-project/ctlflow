using System.Text;
using System.Globalization;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Service.Identity;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildInvocationSecret(
        RunRecord run,
        InvocationCredential credential,
        string namespaceName,
        string secretName)
    {
        var token = Encoding.UTF8.GetBytes(
            credential.ReadForKubernetesProjection());
        try
        {
            return BuildJsonBody(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("apiVersion", "v1");
                writer.WriteString("kind", "Secret");
                var annotations = new Dictionary<string, string>(
                    RunAnnotations(
                        run.PlacementId,
                        run.WorkloadId,
                        run.Id),
                    StringComparer.Ordinal)
                {
                    ["execution.ctlflow.io/credential-expires-at"] =
                        credential.ExpiresAt.ToString(
                            "O",
                            CultureInfo.InvariantCulture)
                };
                WriteMetadata(
                    writer,
                    secretName,
                    namespaceName,
                    annotations);
                writer.WriteString("type", "Opaque");
                writer.WriteStartObject("data");
                writer.WriteBase64String("token", token);
                writer.WriteEndObject();
                writer.WriteEndObject();
            });
        }
        finally
        {
            Array.Clear(token);
        }
    }
}
