using System.Globalization;
using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildWorkloadDeployment(
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        string accountName,
        EdgedSettings edged,
        ProductBootstrapSettings bootstrap,
        int replicas)
    {
        var continuous = workload.Behavior as
            WorkloadBehavior.Continuous
            ?? throw new InvalidOperationException(
                "Deployment requires a continuous Workload");
        var labels = new Dictionary<string, string>(
            StringComparer.Ordinal)
        {
            ["execution.ctlflow.io/workload"] = accountName
        };
        return BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "apps/v1");
            writer.WriteString("kind", "Deployment");
            WriteMetadata(
                writer,
                accountName,
                namespaceName,
                WorkloadAnnotations(placement.Id, workload.Id),
                labels);
            writer.WriteStartObject("spec");
            writer.WriteStartObject("strategy");
            writer.WriteString("type", "Recreate");
            writer.WriteEndObject();
            writer.WriteNumber("replicas", replicas);
            writer.WriteStartObject("selector");
            WriteLabels(writer, "matchLabels", labels);
            writer.WriteEndObject();
            writer.WriteStartObject("template");
            writer.WriteStartObject("metadata");
            writer.WriteStartObject("annotations");
            writer.WriteString(
                "execution.ctlflow.io/workload-revision",
                workload.Revision.Value.ToString(
                    CultureInfo.InvariantCulture));
            writer.WriteEndObject();
            WriteLabels(writer, "labels", labels);
            writer.WriteEndObject();
            writer.WriteStartObject("spec");
            writer.WriteString(
                "serviceAccountName",
                accountName);
            writer.WriteBoolean(
                "automountServiceAccountToken",
                false);
            writer.WriteStartObject("securityContext");
            writer.WriteNumber("fsGroup", 65_532);
            writer.WriteString(
                "fsGroupChangePolicy",
                "OnRootMismatch");
            writer.WriteBoolean("runAsNonRoot", true);
            writer.WriteEndObject();
            writer.WriteStartArray("containers");
            WriteApplicationContainer(writer, workload, bootstrap);
            WriteEdgedContainers(
                writer,
                placement.Target,
                workload,
                edged);
            writer.WriteEndArray();
            WriteVolumes(writer, workload, bootstrap);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
    }

    private static void WriteApplicationContainer(
        Utf8JsonWriter writer,
        WorkloadRecord workload,
        ProductBootstrapSettings bootstrap)
    {
        writer.WriteStartObject();
        writer.WriteString("name", "application");
        writer.WriteString(
            "image",
            workload.AdmittedPackage.ArtifactRepository.Value
            + "@"
            + workload.AdmittedPackage.ArtifactManifestDigest.Value);
        writer.WriteString("imagePullPolicy", "IfNotPresent");
        writer.WriteStartArray("env");
        WriteProductBootstrapEnvironment(
            writer,
            bootstrap,
            workload.AdmittedPackage.AppId.Value);
        writer.WriteEndArray();
        writer.WriteStartObject("resources");
        writer.WriteStartObject("requests");
        WriteResourceValues(writer, workload);
        writer.WriteEndObject();
        writer.WriteStartObject("limits");
        WriteResourceValues(writer, workload);
        writer.WriteEndObject();
        writer.WriteEndObject();
        writer.WriteStartArray("ports");
        foreach (var item in workload.Interfaces)
        {
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"app-{item.InterfaceId.Value}"[..Math.Min(
                    15,
                    4 + item.InterfaceId.Value.Length)]);
            writer.WriteNumber("containerPort", item.Port);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        WriteVolumeMounts(writer, workload);
        writer.WriteEndObject();
    }

    private static void WriteEdgedContainers(
        Utf8JsonWriter writer,
        PlacementTarget target,
        WorkloadRecord workload,
        EdgedSettings edged)
    {
        var index = 0;
        foreach (var item in workload.Interfaces.Where(
                     value => value.ExposureId is not null))
        {
            writer.WriteStartObject();
            writer.WriteString("name", $"edged-{index}");
            writer.WriteString("image", edged.Image);
            writer.WriteString("imagePullPolicy", "IfNotPresent");
            writer.WriteStartArray("env");
            WriteEnvironment(
                writer,
                "CTLFLOW_EDGED_BINDING",
                CreateEdgedBinding(target, item.Port));
            WriteEnvironment(
                writer,
                "CTLFLOW_PUBLIC_URL",
                $"http://0.0.0.0:{10_000 + index}");
            WriteEnvironment(
                writer,
                "CTLFLOW_PROBE_URL",
                $"http://0.0.0.0:{20_000 + index}");
            WriteEnvironment(
                writer,
                "CTLFLOW_IDENTITY_URL",
                edged.IdentityEndpoint.AbsoluteUri);
            WriteEnvironment(
                writer,
                "CTLFLOW_IDENTITY_TLS_SERVER_NAME",
                edged.IdentityServerName);
            WriteEnvironment(
                writer,
                "CTLFLOW_IDENTITY_TLS_CA_PATH",
                EdgedCredentialPath(index, "identityd-ca.crt"));
            WriteEnvironment(
                writer,
                "CTLFLOW_WORKLOAD_TOKEN_FILE",
                EdgedCredentialPath(index, "token"));
            WriteEnvironment(
                writer,
                "CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS",
                ((long)edged.IdentityCallTimeout.TotalMilliseconds)
                    .ToString(CultureInfo.InvariantCulture));
            WriteEnvironment(
                writer,
                "OTEL_EXPORTER_OTLP_ENDPOINT",
                edged.TelemetryEndpoint.AbsoluteUri);
            writer.WriteEndArray();
            writer.WriteStartArray("ports");
            writer.WriteStartObject();
            writer.WriteString("name", $"edge-{index}");
            writer.WriteNumber(
                "containerPort",
                10_000 + index);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("name", $"probe-{index}");
            writer.WriteNumber(
                "containerPort",
                20_000 + index);
            writer.WriteEndObject();
            writer.WriteEndArray();
            WriteHttpProbe(
                writer,
                "livenessProbe",
                "/healthz",
                $"probe-{index}");
            WriteHttpProbe(
                writer,
                "readinessProbe",
                "/readyz",
                $"probe-{index}");
            writer.WriteStartObject("securityContext");
            writer.WriteBoolean(
                "allowPrivilegeEscalation",
                false);
            writer.WriteStartObject("capabilities");
            writer.WriteStartArray("drop");
            writer.WriteStringValue("ALL");
            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteBoolean("readOnlyRootFilesystem", true);
            writer.WriteNumber("runAsGroup", 65_532);
            writer.WriteNumber("runAsUser", 65_532);
            writer.WriteEndObject();
            writer.WriteStartArray("volumeMounts");
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"edged-credentials-{index}");
            writer.WriteString(
                "mountPath",
                EdgedCredentialDirectory(index));
            writer.WriteBoolean("readOnly", true);
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
            index++;
        }
    }

    // The distro-neutral product runtime bootstrap. The values name identity,
    // trust, endpoints, validation settings, and the admitted App ID only.
    private static void WriteProductBootstrapEnvironment(
        Utf8JsonWriter writer,
        ProductBootstrapSettings bootstrap,
        string appId)
    {
        WriteEnvironment(
            writer,
            "CTLFLOW_WORKLOAD_TOKEN_FILE",
            ProductTokenPath);
        WriteEnvironment(
            writer,
            "CTLFLOW_WORKLOAD_JWKS_PATH",
            $"{ProductTrustDirectory}/workload-jwks.json");
        WriteEnvironment(
            writer,
            "CTLFLOW_IDENTITYD_ENDPOINT",
            bootstrap.IdentityEndpoint.AbsoluteUri);
        WriteEnvironment(
            writer,
            "CTLFLOW_IDENTITYD_TLS_CA_PATH",
            $"{ProductTrustDirectory}/identityd-ca.crt");
        WriteEnvironment(
            writer,
            "CTLFLOW_POLICYD_ENDPOINT",
            bootstrap.PolicyEndpoint.AbsoluteUri);
        WriteEnvironment(
            writer,
            "CTLFLOW_POLICYD_TLS_CA_PATH",
            $"{ProductTrustDirectory}/policyd-ca.crt");
        WriteEnvironment(
            writer,
            "CTLFLOW_WORKLOAD_TOKEN_ISSUER",
            bootstrap.WorkloadTokenIssuer);
        WriteEnvironment(
            writer,
            "CTLFLOW_WORKLOAD_TOKEN_AUDIENCE",
            bootstrap.WorkloadTokenAudience);
        WriteEnvironment(
            writer,
            "CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS",
            bootstrap.WorkloadTokenMaximumLifetimeSeconds.ToString(
                CultureInfo.InvariantCulture));
        WriteEnvironment(
            writer,
            "CTLFLOW_INVOCATION_ISSUER",
            bootstrap.InvocationIssuer);
        WriteEnvironment(
            writer,
            "CTLFLOW_INVOCATION_AUDIENCE",
            bootstrap.InvocationAudience);
        WriteEnvironment(writer, "CTLFLOW_APP_ID", appId);
    }

    private static void WriteProductBootstrapMounts(
        Utf8JsonWriter writer)
    {
        writer.WriteStartObject();
        writer.WriteString("name", "product-token");
        writer.WriteString(
            "mountPath",
            ProductTokenDirectory);
        writer.WriteBoolean("readOnly", true);
        writer.WriteEndObject();
        writer.WriteStartObject();
        writer.WriteString("name", "product-trust");
        writer.WriteString(
            "mountPath",
            ProductTrustDirectory);
        writer.WriteBoolean("readOnly", true);
        writer.WriteEndObject();
    }

    private static void WriteProductBootstrapVolumes(
        Utf8JsonWriter writer,
        Domain.Identifiers.WorkloadId workloadId,
        ProductBootstrapSettings bootstrap)
    {
        writer.WriteStartObject();
        writer.WriteString("name", "product-token");
        writer.WriteStartObject("projected");
        writer.WriteNumber("defaultMode", 288);
        writer.WriteStartArray("sources");
        writer.WriteStartObject();
        writer.WriteStartObject("serviceAccountToken");
        writer.WriteString(
            "audience",
            bootstrap.WorkloadTokenAudience);
        writer.WriteNumber(
            "expirationSeconds",
            bootstrap.WorkloadTokenMaximumLifetimeSeconds);
        writer.WriteString("path", "token");
        writer.WriteEndObject();
        writer.WriteEndObject();
        writer.WriteEndArray();
        writer.WriteEndObject();
        writer.WriteEndObject();

        writer.WriteStartObject();
        writer.WriteString("name", "product-trust");
        writer.WriteStartObject("configMap");
        writer.WriteString(
            "name",
            NativeNames.WorkloadTrustConfigMap(workloadId));
        writer.WriteEndObject();
        writer.WriteEndObject();
    }

    private const string ProductTokenDirectory =
        "/var/run/secrets/ctlflow";
    private const string ProductTokenPath =
        $"{ProductTokenDirectory}/token";
    private const string ProductTrustDirectory =
        "/var/run/ctlflow/trust";

    private static void WriteVolumes(
        Utf8JsonWriter writer,
        WorkloadRecord workload,
        ProductBootstrapSettings bootstrap)
    {
        writer.WriteStartArray("volumes");
        WriteProductBootstrapVolumes(writer, workload.Id, bootstrap);
        var projectionIndex = 0;
        foreach (var target in AllProjectionTargets(workload))
        {
            var projectionId = target.ProjectionId
                ?? throw new InvalidOperationException(
                    "Projection is unresolved");
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"projection-{projectionIndex}");
            var source = target.Target.Kind == DataKind.Configuration
                ? "configMap"
                : "secret";
            writer.WriteStartObject(source);
            writer.WriteString(
                "name",
                NativeNames.ProjectionObject(projectionId));
            writer.WriteEndObject();
            writer.WriteEndObject();
            projectionIndex++;
        }

        var storageIndex = 0;
        foreach (var storage in workload.Storage)
        {
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"storage-{storageIndex}");
            writer.WriteStartObject("persistentVolumeClaim");
            writer.WriteString(
                "claimName",
                NativeNames.StorageClaim(
                    workload.Id,
                    storage.StorageId));
            writer.WriteEndObject();
            writer.WriteEndObject();
            storageIndex++;
        }

        var edgeIndex = 0;
        foreach (var _ in workload.Interfaces.Where(
                     value => value.ExposureId is not null))
        {
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"edged-credentials-{edgeIndex}");
            writer.WriteStartObject("projected");
            writer.WriteNumber("defaultMode", 288);
            writer.WriteStartArray("sources");
            writer.WriteStartObject();
            writer.WriteStartObject("configMap");
            writer.WriteString(
                "name",
                NativeNames.EdgedTrustConfigMap(workload.Id));
            writer.WriteStartArray("items");
            writer.WriteStartObject();
            writer.WriteString("key", "identityd-ca.crt");
            writer.WriteString("path", "identityd-ca.crt");
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteStartObject("serviceAccountToken");
            writer.WriteString("audience", "ctlflow-edged");
            writer.WriteNumber("expirationSeconds", 600);
            writer.WriteString("path", "token");
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndObject();
            edgeIndex++;
        }

        writer.WriteEndArray();
    }

    private static void WriteVolumeMounts(
        Utf8JsonWriter writer,
        WorkloadRecord workload)
    {
        writer.WriteStartArray("volumeMounts");
        WriteProductBootstrapMounts(writer);
        var projectionIndex = 0;
        foreach (var target in AllProjectionTargets(workload))
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
        foreach (var storage in workload.Storage)
        {
            writer.WriteStartObject();
            writer.WriteString(
                "name",
                $"storage-{storageIndex}");
            writer.WriteString(
                "mountPath",
                storage.MountPath.Value);
            writer.WriteEndObject();
            storageIndex++;
        }

        writer.WriteEndArray();
    }

    private static IReadOnlyList<
        Domain.Configuration.ResolvedConfigTarget>
        AllProjectionTargets(WorkloadRecord workload) =>
        workload.ConfigTargets
            .Concat(workload.Dependencies.SelectMany(item =>
                item.Selection.Parameters.Select(parameter =>
                    parameter.Target)))
            .Concat(workload.Dependencies.SelectMany(item =>
                item.Outputs))
            .ToArray();

    private static void WriteResourceValues(
        Utf8JsonWriter writer,
        WorkloadRecord workload)
    {
        writer.WriteString(
            "cpu",
            workload.Resources.CpuMillis.ToString(
                CultureInfo.InvariantCulture) + "m");
        writer.WriteString(
            "memory",
            workload.Resources.MemoryBytes.ToString(
                CultureInfo.InvariantCulture));
    }

    private static void WriteLabels(
        Utf8JsonWriter writer,
        string property,
        IReadOnlyDictionary<string, string> labels)
    {
        writer.WriteStartObject(property);
        foreach (var label in labels)
        {
            writer.WriteString(label.Key, label.Value);
        }

        writer.WriteEndObject();
    }

    private static void WriteEnvironment(
        Utf8JsonWriter writer,
        string name,
        string value)
    {
        writer.WriteStartObject();
        writer.WriteString("name", name);
        writer.WriteString("value", value);
        writer.WriteEndObject();
    }

    private static void WriteHttpProbe(
        Utf8JsonWriter writer,
        string name,
        string path,
        string port)
    {
        writer.WriteStartObject(name);
        writer.WriteStartObject("httpGet");
        writer.WriteString("path", path);
        writer.WriteString("port", port);
        writer.WriteEndObject();
        writer.WriteEndObject();
    }

    private static string EdgedCredentialDirectory(int index) =>
        $"/var/run/ctlflow/edged/{index}";

    private static string EdgedCredentialPath(
        int index,
        string file) =>
        $"{EdgedCredentialDirectory(index)}/{file}";

    private static string CreateEdgedBinding(
        PlacementTarget target,
        int upstreamPort)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schema_version", 1);
            writer.WriteStartObject("target");
            switch (target)
            {
                case PlacementTarget.Tenant tenant:
                    writer.WriteString(
                        "tenant_id",
                        tenant.TenantId.Value);
                    break;
                case PlacementTarget.Workspace workspace:
                    writer.WriteString(
                        "tenant_id",
                        workspace.TenantId.Value);
                    writer.WriteString(
                        "workspace_id",
                        workspace.WorkspaceId.Value);
                    break;
                default:
                    throw new InvalidOperationException(
                        "Edged target is invalid");
            }

            writer.WriteEndObject();
            writer.WriteNumber("upstream_port", upstreamPort);
            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(
            stream.ToArray());
    }
}
