using System.Text.Json.Serialization;

namespace CtlFlow.Edge.Edged.Service.Configuration;

internal sealed class BindingDocument
{
    [JsonPropertyName("schema_version")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("target")]
    public BindingTargetDocument? Target { get; init; }

    [JsonPropertyName("upstream_port")]
    public int UpstreamPort { get; init; }
}

internal sealed class BindingTargetDocument
{
    [JsonPropertyName("tenant_id")]
    public string? TenantId { get; init; }

    [JsonPropertyName("workspace_id")]
    public string? WorkspaceId { get; init; }
}
