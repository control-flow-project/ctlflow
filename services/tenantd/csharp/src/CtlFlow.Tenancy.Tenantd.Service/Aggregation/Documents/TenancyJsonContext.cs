using System.Text.Json.Serialization;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    GenerationMode = JsonSourceGenerationMode.Metadata,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow)]
[JsonSerializable(typeof(TenantDocument))]
[JsonSerializable(typeof(TenantListDocument))]
[JsonSerializable(typeof(WorkspaceDocument))]
[JsonSerializable(typeof(WorkspaceListDocument))]
[JsonSerializable(typeof(LifecycleActionDocument))]
[JsonSerializable(typeof(ApiResourceListDocument))]
[JsonSerializable(typeof(KubernetesStatusDocument))]
internal sealed partial class TenancyJsonContext : JsonSerializerContext;
