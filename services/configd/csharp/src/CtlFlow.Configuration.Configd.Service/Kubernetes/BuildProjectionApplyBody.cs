using System.Buffers;
using System.Text;
using System.Text.Json;
using CtlFlow.Configuration.Configd.Db.Projections;
using CtlFlow.Configuration.Configd.Domain.Projections;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static byte[] BuildProjectionApplyBody(
        ProjectionMetadata projection,
        ProjectionPayloadLease payload,
        VerifiedWorkload workload,
        string objectName,
        string? resourceVersion)
    {
        var material = new byte[payload.Length];
        payload.CopyTo(material);
        try
        {
            var output = new ArrayBufferWriter<byte>(payload.Length + 1_024);
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartObject();
                writer.WriteString("apiVersion", "v1");
                writer.WriteString(
                    "kind",
                    projection.Target.Kind
                        == ProjectionDataKind.Configuration
                        ? "ConfigMap"
                        : "Secret");
                WriteMetadata(
                    writer,
                    projection,
                    workload,
                    objectName,
                    resourceVersion);
                if (projection.Target.Kind == ProjectionDataKind.Secret)
                {
                    writer.WriteString("type", "Opaque");
                }

                writer.WriteStartObject("data");
                if (projection.Target.Kind
                    == ProjectionDataKind.Configuration)
                {
                    writer.WriteString(
                        "content",
                        new UTF8Encoding(
                            encoderShouldEmitUTF8Identifier: false,
                            throwOnInvalidBytes: true)
                            .GetString(material));
                }
                else
                {
                    writer.WriteBase64String("content", material);
                }

                writer.WriteEndObject();
                writer.WriteEndObject();
                writer.Flush();
            }

            return output.WrittenSpan.ToArray();
        }
        finally
        {
            Array.Clear(material);
        }
    }

    private static void WriteMetadata(
        Utf8JsonWriter writer,
        ProjectionMetadata projection,
        VerifiedWorkload workload,
        string objectName,
        string? resourceVersion)
    {
        writer.WriteStartObject("metadata");
        writer.WriteString("name", objectName);
        writer.WriteString("namespace", workload.NamespaceName);
        if (resourceVersion is not null)
        {
            writer.WriteString(
                "resourceVersion",
                resourceVersion);
        }
        writer.WriteStartObject("annotations");
        writer.WriteString(
            "configuration.ctlflow.io/owner-service",
            "configd");
        writer.WriteString(
            "configuration.ctlflow.io/projection-id",
            projection.Id.Value);
        writer.WriteString(
            "execution.ctlflow.io/placement-id",
            projection.Binding.Placement.PlacementId.Value);
        writer.WriteString(
            "execution.ctlflow.io/workload-id",
            projection.Binding.ConsumerId.Value);
        writer.WriteEndObject();
        writer.WriteStartArray("ownerReferences");
        writer.WriteStartObject();
        writer.WriteString("apiVersion", "v1");
        writer.WriteString("kind", "ServiceAccount");
        writer.WriteString("name", workload.ServiceAccountName);
        writer.WriteString("uid", workload.ServiceAccountUid);
        writer.WriteBoolean("controller", false);
        writer.WriteBoolean("blockOwnerDeletion", false);
        writer.WriteEndObject();
        writer.WriteEndArray();
        writer.WriteEndObject();
    }
}
