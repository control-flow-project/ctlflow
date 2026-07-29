using System.Text;
using System.Text.Json;
using CtlFlow.Edge.Edged.Domain.Bindings;
using CtlFlow.Edge.Edged.Domain.Identifiers;

namespace CtlFlow.Edge.Edged.Service.Configuration;

internal static partial class EdgedConfiguration
{
    private const int MaximumBindingBytes = 64 * 1024;

    internal static async Task<EdgedBinding> ParseBinding(
        string encoded,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (Encoding.UTF8.GetByteCount(encoded) > MaximumBindingBytes)
        {
            throw new InvalidOperationException(
                "CTLFLOW_EDGED_BINDING exceeds 64 KiB");
        }

        BindingDocument document;
        try
        {
            ValidateDocumentShape(encoded);
            document = JsonSerializer.Deserialize(
                encoded,
                BindingJsonContext.Default.BindingDocument)
                ?? throw new JsonException();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException(
                "CTLFLOW_EDGED_BINDING is invalid",
                exception);
        }

        if (document.SchemaVersion != 1
            || document.Target?.TenantId is null)
        {
            throw new InvalidOperationException(
                "CTLFLOW_EDGED_BINDING is invalid");
        }

        var tenantId = await TenantId.Parse(
            document.Target.TenantId,
            cancellation);
        ExposureTarget target = document.Target.WorkspaceId is null
            ? new ExposureTarget.Tenant(tenantId)
            : new ExposureTarget.Workspace(
                tenantId,
                await WorkspaceId.Parse(
                    document.Target.WorkspaceId,
                    cancellation));
        return new EdgedBinding(
            target,
            await ApplicationPort.Parse(
                document.UpstreamPort,
                cancellation));
    }

    private static void ValidateDocumentShape(string encoded)
    {
        using var json = JsonDocument.Parse(
            encoded,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4
            });
        RequireObjectProperties(
            json.RootElement,
            new[] { "schema_version", "target", "upstream_port" });
        if (!json.RootElement.TryGetProperty(
                "target",
                out var target))
        {
            throw new JsonException();
        }

        RequireObjectProperties(
            target,
            target.TryGetProperty("workspace_id", out _)
                ? new[] { "tenant_id", "workspace_id" }
                : new[] { "tenant_id" });
        if (target.GetProperty("tenant_id").ValueKind
                != JsonValueKind.String
            || target.TryGetProperty(
                    "workspace_id",
                    out var workspace)
                && workspace.ValueKind != JsonValueKind.String)
        {
            throw new JsonException();
        }
    }

    private static void RequireObjectProperties(
        JsonElement element,
        IReadOnlyCollection<string> expected)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException();
        }

        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!actual.Add(property.Name)
                || !expected.Contains(property.Name))
            {
                throw new JsonException();
            }
        }

        if (!actual.SetEquals(expected))
        {
            throw new JsonException();
        }
    }
}
