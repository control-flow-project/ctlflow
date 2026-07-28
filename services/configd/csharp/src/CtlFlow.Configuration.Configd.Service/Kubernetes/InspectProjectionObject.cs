using System.Text;
using System.Text.Json;
using CtlFlow.Configuration.Configd.Db.Projections;
using CtlFlow.Configuration.Configd.Domain.Projections;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static ProjectionObjectState InspectProjectionObject(
        JsonElement root,
        ProjectionMetadata projection,
        ProjectionPayloadLease payload,
        VerifiedWorkload workload,
        string objectName)
    {
        try
        {
            return InspectProjectionObjectShape(
                root,
                projection,
                payload,
                workload,
                objectName);
        }
        catch (InvalidDataException)
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }

    private static ProjectionObjectState InspectProjectionObjectShape(
        JsonElement root,
        ProjectionMetadata projection,
        ProjectionPayloadLease payload,
        VerifiedWorkload workload,
        string objectName)
    {
        var expectedKind = projection.Target.Kind
            == ProjectionDataKind.Configuration
            ? "ConfigMap"
            : "Secret";
        if (!string.Equals(
                ReadRequiredString(root, "apiVersion", 32),
                "v1",
                StringComparison.Ordinal)
            || !string.Equals(
                ReadRequiredString(root, "kind", 32),
                expectedKind,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }

        var metadata = ReadRequiredObject(root, "metadata");
        RequireExactName(metadata, objectName);
        if (!string.Equals(
                ReadRequiredString(metadata, "namespace", 253),
                workload.NamespaceName,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }

        RequireExactProjectionAnnotations(metadata, projection);
        RequireExactOwnerReference(metadata, workload);
        if (projection.Target.Kind == ProjectionDataKind.Secret
            && (!root.TryGetProperty("type", out var type)
                || type.ValueKind != JsonValueKind.String
                || !string.Equals(
                    type.GetString(),
                    "Opaque",
                    StringComparison.Ordinal)))
        {
            throw new KubernetesOwnershipCollisionException();
        }

        var data = ReadRequiredObject(root, "data");
        using var properties = data.EnumerateObject();
        if (!properties.MoveNext())
        {
            return ProjectionObjectState.Drifted;
        }

        var content = properties.Current;
        if (!string.Equals(
                content.Name,
                "content",
                StringComparison.Ordinal)
            || properties.MoveNext())
        {
            throw new KubernetesOwnershipCollisionException();
        }

        if (content.Value.ValueKind != JsonValueKind.String)
        {
            return ProjectionObjectState.Drifted;
        }

        var expected = new byte[payload.Length];
        payload.CopyTo(expected);
        try
        {
            return ContentMatches(
                    content.Value.GetString() ?? string.Empty,
                    projection.Target.Kind,
                    expected)
                ? ProjectionObjectState.Current
                : ProjectionObjectState.Drifted;
        }
        finally
        {
            Array.Clear(expected);
        }
    }

    private static bool ContentMatches(
        string actual,
        ProjectionDataKind kind,
        ReadOnlySpan<byte> expected)
    {
        if (kind == ProjectionDataKind.Configuration)
        {
            return Encoding.UTF8.GetBytes(actual).AsSpan()
                .SequenceEqual(expected);
        }

        try
        {
            var decoded = Convert.FromBase64String(actual);
            try
            {
                return decoded.AsSpan().SequenceEqual(expected);
            }
            finally
            {
                Array.Clear(decoded);
            }
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static void RequireExactProjectionAnnotations(
        JsonElement metadata,
        ProjectionMetadata projection)
    {
        var annotations = ReadRequiredObject(metadata, "annotations");
        if (annotations.EnumerateObject().Count() != 4)
        {
            throw new KubernetesOwnershipCollisionException();
        }

        RequireAnnotation(
            metadata,
            "configuration.ctlflow.io/owner-service",
            "configd");
        RequireAnnotation(
            metadata,
            "configuration.ctlflow.io/projection-id",
            projection.Id.Value);
        RequireAnnotation(
            metadata,
            "execution.ctlflow.io/placement-id",
            projection.Binding.Placement.PlacementId.Value);
        RequireAnnotation(
            metadata,
            "execution.ctlflow.io/workload-id",
            projection.Binding.ConsumerId.Value);
    }

    private static void RequireExactOwnerReference(
        JsonElement metadata,
        VerifiedWorkload workload)
    {
        if (!metadata.TryGetProperty(
                "ownerReferences",
                out var references)
            || references.ValueKind != JsonValueKind.Array
            || references.GetArrayLength() != 1)
        {
            throw new KubernetesOwnershipCollisionException();
        }

        var owner = references[0];
        if (!string.Equals(
                ReadRequiredString(owner, "apiVersion", 32),
                "v1",
                StringComparison.Ordinal)
            || !string.Equals(
                ReadRequiredString(owner, "kind", 32),
                "ServiceAccount",
                StringComparison.Ordinal)
            || !string.Equals(
                ReadRequiredString(owner, "name", 253),
                workload.ServiceAccountName,
                StringComparison.Ordinal)
            || !string.Equals(
                ReadRequiredString(owner, "uid", 128),
                workload.ServiceAccountUid,
                StringComparison.Ordinal)
            || !IsFalse(owner, "controller")
            || !IsFalse(owner, "blockOwnerDeletion"))
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }

    private static bool IsFalse(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var value)
        && value.ValueKind == JsonValueKind.False;
}
