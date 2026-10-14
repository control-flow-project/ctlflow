using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record NativeSelection(string Model, string Effort);

public static class ModelAdmission
{
    private sealed record Model(string Name, bool Default, string Effort, IReadOnlySet<string> Efforts);
    public static async ValueTask<Result<NativeSelection>> Read(CodexProtocol protocol, CodexOptions options, CancellationToken cancellation)
    {
        var read = CodexJson.ObjectReply(await protocol.Request("config/read", CodexJson.Object(writer => writer.WriteBoolean("includeLayers", false)), cancellation));
        if (!read.IsSuccess) return Result<NativeSelection>.Fail(read.Error);
        if (!read.Value.TryGetProperty("config", out var config) || config.ValueKind != JsonValueKind.Object) return Invalid("Codex did not expose its effective native configuration");
        var models = new Dictionary<string, Model>(StringComparer.Ordinal); var cursors = new HashSet<string>(StringComparer.Ordinal); string? cursor = null;
        do
        {
            var response = CodexJson.ObjectReply(await protocol.Request("model/list", CodexJson.Object(writer =>
            { writer.WriteBoolean("includeHidden", true); writer.WriteNumber("limit", 100); if (cursor is not null) writer.WriteString("cursor", cursor); }), cancellation));
            if (!response.IsSuccess) return Result<NativeSelection>.Fail(response.Error);
            var listing = response.Value;
            if (!listing.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || models.Count + data.GetArrayLength() > 2000 || cursors.Count >= 2000)
                return Invalid("Invalid or excessive native model catalog");
            foreach (var value in data.EnumerateArray())
            {
                var name = CodexJson.String(value, "model"); var effort = CodexJson.String(value, "defaultReasoningEffort");
                if (string.IsNullOrEmpty(name) || effort is null || !value.TryGetProperty("isDefault", out var isDefault) || isDefault.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                    || !value.TryGetProperty("supportedReasoningEfforts", out var supported) || supported.ValueKind != JsonValueKind.Array) return Invalid("Invalid native model capabilities");
                var efforts = new HashSet<string>(StringComparer.Ordinal);
                foreach (var item in supported.EnumerateArray())
                {
                    var reasoning = CodexJson.String(item, "reasoningEffort");
                    if (string.IsNullOrEmpty(reasoning) || !efforts.Add(reasoning)) return Invalid("Invalid or ambiguous native reasoning capabilities");
                }
                if (!efforts.Contains(effort) || !models.TryAdd(name, new(name, isDefault.GetBoolean(), effort, efforts))) return Invalid("Ambiguous native model catalog or unsupported native default effort");
            }
            cursor = null;
            if (listing.TryGetProperty("nextCursor", out var next) && next.ValueKind != JsonValueKind.Null)
            {
                if (next.ValueKind != JsonValueKind.String || next.GetString() is not { Length: > 0 and <= 4096 } nextCursor || data.GetArrayLength() == 0 || !cursors.Add(nextCursor))
                    return Invalid("Invalid native model catalog pagination");
                cursor = nextCursor;
            }
        } while (cursor is not null);
        var selected = options.Model;
        if (selected is null && config.TryGetProperty("model", out var configuredModel) && configuredModel.ValueKind != JsonValueKind.Null)
        {
            if (configuredModel.ValueKind != JsonValueKind.String) return Results.Fail<NativeSelection>("invalid", "Configured model is unavailable in this native engine");
            selected = configuredModel.GetString();
        }
        Model? model;
        if (selected is null) { var defaults = models.Values.Where(value => value.Default).ToArray(); model = defaults.Length == 1 ? defaults[0] : null; }
        else models.TryGetValue(selected, out model);
        if (model is null) return Results.Fail<NativeSelection>("invalid", "Configured or default model is unavailable in this native engine; select an exact advertised model");
        var effortValue = options.Effort;
        if (effortValue is null && config.TryGetProperty("model_reasoning_effort", out var configuredEffort) && configuredEffort.ValueKind != JsonValueKind.Null)
        {
            if (configuredEffort.ValueKind != JsonValueKind.String) return Results.Fail<NativeSelection>("invalid", "Configured reasoning effort is not an advertised native value");
            effortValue = configuredEffort.GetString();
        }
        effortValue ??= model.Effort;
        return model.Efforts.Contains(effortValue) ? Result<NativeSelection>.Success(new(model.Name, effortValue))
            : Results.Fail<NativeSelection>("invalid", "Reasoning effort " + effortValue + " is unavailable for model " + model.Name + "; no model or effort was substituted");
    }
    private static Result<NativeSelection> Invalid(string message) => Results.Fail<NativeSelection>("native", message);
}
