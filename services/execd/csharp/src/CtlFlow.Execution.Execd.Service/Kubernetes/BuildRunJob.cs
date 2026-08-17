using System.Globalization;
using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Service.Configuration;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildRunJob(
        RunRecord run,
        string namespaceName,
        string accountName,
        string jobName,
        string? invocationSecretName,
        ProductBootstrapSettings bootstrap)
    {
        var labels = new Dictionary<string, string>(
            StringComparer.Ordinal)
        {
            ["execution.ctlflow.io/run"] = jobName
        };
        return BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "batch/v1");
            writer.WriteString("kind", "Job");
            WriteMetadata(
                writer,
                jobName,
                namespaceName,
                RunAnnotations(
                    run.PlacementId,
                    run.WorkloadId,
                    run.Id),
                labels);
            writer.WriteStartObject("spec");
            writer.WriteNumber(
                "backoffLimit",
                Math.Max(0, run.Execution.MaxAttempts - 1));
            writer.WriteNumber(
                "activeDeadlineSeconds",
                run.Execution.RunDurationSeconds);
            writer.WriteStartObject("template");
            writer.WriteStartObject("metadata");
            WriteLabels(writer, labels);
            writer.WriteEndObject();
            writer.WriteStartObject("spec");
            writer.WriteString("restartPolicy", "Never");
            writer.WriteString(
                "serviceAccountName",
                accountName);
            writer.WriteBoolean(
                "automountServiceAccountToken",
                false);
            // The product runtime bootstrap is projected read-only for the
            // pod's group; without the same fsGroup a Run container cannot
            // read its own token.
            writer.WriteStartObject("securityContext");
            writer.WriteNumber("fsGroup", 65_532);
            writer.WriteString(
                "fsGroupChangePolicy",
                "OnRootMismatch");
            writer.WriteBoolean("runAsNonRoot", true);
            writer.WriteEndObject();
            writer.WriteStartArray("containers");
            WriteRunContainer(
                writer,
                run,
                invocationSecretName,
                bootstrap);
            writer.WriteEndArray();
            WriteRunVolumes(
                writer,
                run,
                invocationSecretName,
                bootstrap);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
    }

    private static void WriteRunContainer(
        Utf8JsonWriter writer,
        RunRecord run,
        string? invocationSecretName,
        ProductBootstrapSettings bootstrap)
    {
        writer.WriteStartObject();
        writer.WriteString("name", "run");
        writer.WriteString(
            "image",
            run.Execution.AdmittedPackage.ArtifactRepository.Value
            + "@"
            + run.Execution.AdmittedPackage
                .ArtifactManifestDigest.Value);
        writer.WriteString("imagePullPolicy", "IfNotPresent");
        writer.WriteStartArray("env");
        WriteProductBootstrapEnvironment(
            writer,
            bootstrap,
            run.Execution.AdmittedPackage.AppId.Value);
        writer.WriteEndArray();
        writer.WriteStartObject("resources");
        writer.WriteStartObject("requests");
        WriteRunResources(writer, run);
        writer.WriteEndObject();
        writer.WriteStartObject("limits");
        WriteRunResources(writer, run);
        writer.WriteEndObject();
        writer.WriteEndObject();
        writer.WriteStartArray("volumeMounts");
        WriteProductBootstrapMounts(writer);
        var projectionIndex = 0;
        foreach (var target in AllRunTargets(run))
        {
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"projection-{projectionIndex}");
            writer.WriteString(
                "mountPath",
                NativeNames.ProjectionMountPath(
                    target.Target.Kind,
                    target.Target.Purpose));
            writer.WriteString("subPath", "content");
            writer.WriteBoolean("readOnly", true);
            writer.WriteEndObject();
            projectionIndex++;
        }

        var storageIndex = 0;
        foreach (var storage in run.Execution.Storage)
        {
            writer.WriteStartObject();
            writer.WriteString("name", $"storage-{storageIndex}");
            writer.WriteString(
                "mountPath",
                storage.MountPath.Value);
            writer.WriteEndObject();
            storageIndex++;
        }

        if (invocationSecretName is not null)
        {
            writer.WriteStartObject();
            writer.WriteString("name", "invocation");
            writer.WriteString(
                "mountPath",
                "/run/ctlflow/invocation/token");
            writer.WriteString("subPath", "token");
            writer.WriteBoolean("readOnly", true);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void WriteRunVolumes(
        Utf8JsonWriter writer,
        RunRecord run,
        string? invocationSecretName,
        ProductBootstrapSettings bootstrap)
    {
        writer.WriteStartArray("volumes");
        WriteProductBootstrapVolumes(
            writer,
            run.WorkloadId,
            bootstrap);
        var projectionIndex = 0;
        foreach (var target in AllRunTargets(run))
        {
            var projectionId = target.ProjectionId
                ?? throw new InvalidOperationException(
                    "Run projection is unresolved");
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"projection-{projectionIndex}");
            writer.WriteStartObject(
                target.Target.Kind == DataKind.Configuration
                    ? "configMap"
                    : "secret");
            writer.WriteString(
                "name",
                NativeNames.ProjectionObject(projectionId));
            writer.WriteEndObject();
            writer.WriteEndObject();
            projectionIndex++;
        }

        var storageIndex = 0;
        foreach (var storage in run.Execution.Storage)
        {
            writer.WriteStartObject();
            writer.WriteString("name", $"storage-{storageIndex}");
            writer.WriteStartObject("persistentVolumeClaim");
            writer.WriteString(
                "claimName",
                NativeNames.StorageClaim(
                    run.PlacementId,
                    run.Execution.AdmittedPackage.AppId,
                    storage.StorageId));
            writer.WriteEndObject();
            writer.WriteEndObject();
            storageIndex++;
        }

        if (invocationSecretName is not null)
        {
            writer.WriteStartObject();
            writer.WriteString("name", "invocation");
            writer.WriteStartObject("secret");
            writer.WriteString(
                "secretName",
                invocationSecretName);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
    }

    private static IReadOnlyList<
        Domain.Configuration.ResolvedConfigTarget>
        AllRunTargets(RunRecord run) =>
        run.Execution.ConfigTargets
            .Concat(run.Execution.Dependencies.SelectMany(item =>
                item.Selection.Parameters.Select(parameter =>
                    parameter.Target)))
            .Concat(run.Execution.Dependencies.SelectMany(item =>
                item.Outputs))
            .ToArray();

    private static void WriteRunResources(
        Utf8JsonWriter writer,
        RunRecord run)
    {
        writer.WriteString(
            "cpu",
            run.Execution.Resources.CpuMillis.ToString(
                CultureInfo.InvariantCulture) + "m");
        writer.WriteString(
            "memory",
            run.Execution.Resources.MemoryBytes.ToString(
                CultureInfo.InvariantCulture));
    }

    private static void WriteLabels(
        Utf8JsonWriter writer,
        IReadOnlyDictionary<string, string> labels)
    {
        writer.WriteStartObject("labels");
        foreach (var label in labels)
        {
            writer.WriteString(label.Key, label.Value);
        }

        writer.WriteEndObject();
    }
}
