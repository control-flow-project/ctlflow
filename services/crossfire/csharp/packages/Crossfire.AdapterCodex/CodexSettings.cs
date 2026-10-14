using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record CodexOptions(string? Model, string? Effort, string Sandbox, string ApprovalPolicy, bool? Questions, bool FeaturesPresent = false)
{
    public JsonElement Native() => CodexJson.Object(writer =>
    {
        if (Model is not null) writer.WriteString("model", Model);
        if (Effort is not null) writer.WriteString("model_reasoning_effort", Effort);
        writer.WriteString("sandbox_mode", Sandbox); writer.WriteString("approval_policy", ApprovalPolicy);
        if (FeaturesPresent) { writer.WriteStartObject("features"); if (Questions is not null) writer.WriteBoolean("default_mode_request_user_input", Questions.Value); writer.WriteEndObject(); }
    });
}

public static partial class CodexSettings
{
    public static Result<CodexOptions> Parse(JsonElement input)
    {
        var fields = Validation.Fields(input, [], ["model", "model_reasoning_effort", "sandbox_mode", "approval_policy", "dangerously_bypass_approvals_and_sandbox", "features"]);
        if (!fields.IsSuccess) return Result<CodexOptions>.Fail(fields.Error);
        string? model = null; string? effort = null; var sandbox = "danger-full-access"; var approval = "on-request"; bool? questions = null;
        if (input.TryGetProperty("model", out var name)) { var parsed = Validation.Text(name, 200); if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error); model = parsed.Value; }
        if (input.TryGetProperty("model_reasoning_effort", out var reasoning))
        {
            var parsed = Validation.Choice(reasoning, "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra");
            if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error); effort = parsed.Value;
        }
        if (input.TryGetProperty("sandbox_mode", out var mode))
        {
            var parsed = Validation.Choice(mode, "read-only", "workspace-write", "danger-full-access"); if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error); sandbox = parsed.Value;
        }
        if (input.TryGetProperty("approval_policy", out var policy))
        {
            var parsed = Validation.Choice(policy, "untrusted", "on-failure", "on-request", "never"); if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error); approval = parsed.Value;
        }
        if (input.TryGetProperty("dangerously_bypass_approvals_and_sandbox", out var bypass))
        {
            var parsed = Validation.Boolean(bypass); if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error);
            if (parsed.Value)
            {
                if (mode.ValueKind != JsonValueKind.Undefined && sandbox != "danger-full-access" || policy.ValueKind != JsonValueKind.Undefined && approval != "never")
                    return Results.Fail<CodexOptions>("invalid", "dangerously_bypass_approvals_and_sandbox requires danger-full-access and never; remove conflicting sandbox or approval settings");
                sandbox = "danger-full-access"; approval = "never";
            }
        }
        if (input.TryGetProperty("features", out var features))
        {
            var parsed = Validation.Fields(features, [], ["default_mode_request_user_input"]); if (!parsed.IsSuccess) return Result<CodexOptions>.Fail(parsed.Error);
            if (features.TryGetProperty("default_mode_request_user_input", out var flag)) { var value = Validation.Boolean(flag); if (!value.IsSuccess) return Result<CodexOptions>.Fail(value.Error); questions = value.Value; }
        }
        return Result<CodexOptions>.Success(new(model, effort, sandbox, approval, questions, features.ValueKind != JsonValueKind.Undefined));
    }

    public static Result<RuntimeApproval> Approval(JsonElement policy)
    {
        if (policy.ValueKind == JsonValueKind.String)
            return policy.GetString() switch { "never" => Result<RuntimeApproval>.Success(RuntimeApproval.None), "untrusted" or "on-failure" or "on-request" => Result<RuntimeApproval>.Success(RuntimeApproval.Listener),
                _ => Results.Fail<RuntimeApproval>("native", "Codex did not report a supported native approval policy") };
        var outer = Validation.Fields(policy, ["granular"]);
        if (outer.IsSuccess)
        {
            var granular = policy.GetProperty("granular"); var fields = Validation.Fields(granular, ["sandbox_approval", "rules", "skill_approval", "request_permissions", "mcp_elicitations"]);
            if (fields.IsSuccess && granular.EnumerateObject().All(value => value.Value.ValueKind is JsonValueKind.True or JsonValueKind.False))
                return Result<RuntimeApproval>.Success(granular.EnumerateObject().Any(value => value.Value.GetBoolean()) ? RuntimeApproval.Listener : RuntimeApproval.None);
        }
        return Results.Fail<RuntimeApproval>("native", "Codex did not report a supported native approval policy");
    }

    public static Result<Unit> Version(string text)
    {
        var match = NativeVersion().Match(text);
        return match.Success && uint.TryParse(match.Groups[1].Value, out var major) && uint.TryParse(match.Groups[2].Value, out var minor)
            && uint.TryParse(match.Groups[3].Value, out _) && (major > 0 || minor >= 158)
            ? Results.Done() : Results.Fail<Unit>("invalid", "Stock Codex 0.158.0 or newer is required");
    }
    public static Result<Unit> QuestionCapability(string listing)
    {
        var lines = listing.Split('\n').Select(line => line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Where(parts => parts.Length > 0 && parts[0] == "default_mode_request_user_input").ToArray();
        return lines.Length == 1 && lines[0].Length >= 3 && lines[0][^1] is "true" or "false"
            ? Results.Done() : Results.Fail<Unit>("invalid", "This Codex binary does not expose features.default_mode_request_user_input; install a native release that supports it");
    }
    [GeneratedRegex("\\Acodex-cli ([0-9]+)\\.([0-9]+)\\.([0-9]+)\\z", RegexOptions.CultureInvariant)]
    private static partial Regex NativeVersion();
}
