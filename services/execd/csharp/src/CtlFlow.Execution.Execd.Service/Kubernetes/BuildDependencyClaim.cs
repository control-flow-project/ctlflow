using System.Text;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildDependencyClaim(
        PlacementRecord placement,
        WorkloadRecord workload,
        AdmittedDependency dependency,
        ReadOnlyMemory<byte> options,
        string namespaceName)
    {
        var optionsJson = new UTF8Encoding(
            encoderShouldEmitUTF8Identifier: false,
            throwOnInvalidBytes: true).GetString(options.Span);
        return BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString(
                "apiVersion",
                "execution.ctlflow.io/v1");
            writer.WriteString("kind", "DependencyClaim");
            WriteMetadata(
                writer,
                dependency.ClaimId,
                namespaceName,
                WorkloadAnnotations(
                    placement.Id,
                    workload.Id));
            writer.WriteStartObject("spec");
            writer.WriteString("claimId", dependency.ClaimId);
            writer.WriteNumber(
                "claimRevision",
                dependency.ClaimRevision.Value);
            writer.WriteString(
                "placementId",
                placement.Id.Value);
            writer.WriteString("workloadId", workload.Id.Value);
            WritePlacementTarget(writer, placement.Target);
            writer.WriteString(
                "componentId",
                dependency.Selection.ComponentId.Value);
            writer.WriteString(
                "dependencyName",
                dependency.Selection.Name.Value);
            if (dependency.Selection.DependencyId is not null)
            {
                writer.WriteString(
                    "dependencyId",
                    dependency.Selection.DependencyId.Value);
            }

            writer.WriteString(
                "dependencyType",
                dependency.Type.Value);
            writer.WriteString(
                "provisionerId",
                dependency.ProvisionerId.Value);
            writer.WriteString(
                "provisionerSubject",
                dependency.ProvisionerSubject.Value);
            writer.WriteString(
                "optionsCanonicalJson",
                optionsJson);
            writer.WriteStartArray("parameters");
            foreach (var parameter in dependency.Selection.Parameters)
            {
                var projection = parameter.Target.ProjectionId
                    ?? throw new InvalidOperationException(
                        "Dependency parameter projection is unresolved");
                var revision = parameter.Target.ProjectionRevision
                    ?? throw new InvalidOperationException(
                        "Dependency parameter projection is unresolved");
                writer.WriteStartObject();
                writer.WriteString(
                    "parameterName",
                    parameter.Name.Value);
                writer.WriteString(
                    "purpose",
                    parameter.Target.Target.Purpose.Value);
                writer.WriteString(
                    "dataKind",
                    parameter.Target.Target.Kind
                        == DataKind.Configuration
                        ? "configuration"
                        : "secret");
                writer.WriteString(
                    "projectionId",
                    projection.Value);
                writer.WriteNumber(
                    "projectionRevision",
                    revision.Value);
                writer.WriteEndObject();
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
    }

    private static void WritePlacementTarget(
        System.Text.Json.Utf8JsonWriter writer,
        PlacementTarget target)
    {
        writer.WriteStartObject("placementTarget");
        switch (target)
        {
            case PlacementTarget.Global:
                writer.WriteStartObject("global");
                writer.WriteEndObject();
                break;
            case PlacementTarget.Tenant tenant:
                writer.WriteStartObject("tenant");
                writer.WriteString(
                    "tenantId",
                    tenant.TenantId.Value);
                writer.WriteEndObject();
                break;
            case PlacementTarget.Workspace workspace:
                writer.WriteStartObject("workspace");
                writer.WriteString(
                    "tenantId",
                    workspace.TenantId.Value);
                writer.WriteString(
                    "workspaceId",
                    workspace.WorkspaceId.Value);
                writer.WriteEndObject();
                break;
            case PlacementTarget.User user:
                writer.WriteStartObject("user");
                writer.WriteString(
                    "tenantId",
                    user.TenantId.Value);
                writer.WriteString(
                    "accountPrincipalId",
                    user.AccountPrincipalId.Value);
                writer.WriteEndObject();
                break;
            default:
                throw new InvalidOperationException(
                    "Placement target is invalid");
        }

        writer.WriteEndObject();
    }
}
