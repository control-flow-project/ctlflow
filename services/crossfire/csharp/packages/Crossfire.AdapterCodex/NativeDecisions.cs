using System.Text;
using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class NativeDecisions
{
    public static Result<RuntimeDecision> Decode(NativeRequest request, string session, JsonElement? changes)
        => request.Method == "item/tool/requestUserInput" ? Question(request, session) : Permission(request, session, changes);
    private static bool Attribution(JsonElement parameters, string session)
        => CodexJson.String(parameters, "threadId") == session && parameters.TryGetProperty("turnId", out var turn) && Validation.Text(turn).IsSuccess
            && parameters.TryGetProperty("itemId", out var item) && Validation.Text(item).IsSuccess;
    private static bool Text(JsonElement value, int maximum, bool plain = false)
        => (plain ? Validation.PlainText(value, maximum) : Validation.Text(value, maximum)).IsSuccess;
    private static Result<RuntimeDecision> Invalid(string message) => Results.Fail<RuntimeDecision>("invalid", message);
    private static Result<RuntimeDecision> Permission(NativeRequest request, string session, JsonElement? changes)
    {
        var parameters = request.Parameters;
        if (!Attribution(parameters, session)) return Invalid("Runtime decision belongs to an invalid native session");
        JsonElement available; string action; JsonElement scope;
        if (request.Method == "item/commandExecution/requestApproval")
        {
            if (!parameters.TryGetProperty("command", out var command) || command.ValueKind != JsonValueKind.String || command.GetString() is not { Length: > 0 } text
                || text.Contains('\0') || Encoding.UTF8.GetByteCount(text) > 8388608 || !parameters.TryGetProperty("cwd", out var cwd) || !Text(cwd, 4096)
                || !parameters.TryGetProperty("availableDecisions", out available) || available.ValueKind != JsonValueKind.Array)
                return Invalid("Native command approval needs its exact command, workspace and available decisions");
            action = "command execution"; scope = parameters.Clone();
        }
        else if (request.Method == "item/fileChange/requestApproval")
        {
            if (changes is not { ValueKind: JsonValueKind.Array } files || files.GetArrayLength() == 0 || files.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.Object
                || !value.TryGetProperty("path", out var path) || !Text(path, 4096) || !value.TryGetProperty("diff", out var diff) || diff.ValueKind != JsonValueKind.String))
                return Invalid("Native file approval needs the exact pending paths and changes");
            using var choices = JsonDocument.Parse("[\"accept\",\"acceptForSession\",\"decline\",\"cancel\"]"); available = choices.RootElement.Clone(); action = "file changes";
            scope = CodexJson.Object(writer => { writer.WritePropertyName("request"); parameters.WriteTo(writer); writer.WritePropertyName("changes"); files.WriteTo(writer); });
        }
        else return Invalid("Unsupported native permission request");
        if (available.GetArrayLength() is < 1 or > 16) return Invalid("Invalid native permission choice count");
        var decoded = new List<RuntimeDecisionChoice>();
        foreach (var value in available.EnumerateArray())
        {
            var label = Choice(value); if (label is null || decoded.Any(previous => previous.Label == label)) return Invalid("Unsupported or duplicate native permission choices");
            decoded.Add(new(label, CodexJson.Object(writer => { writer.WritePropertyName("decision"); value.WriteTo(writer); })));
        }
        return Result<RuntimeDecision>.Success(new("codex", session, CodexJson.DecisionIdentity(request.Id), action, scope, decoded,
            parameters.GetProperty("turnId").GetString(), parameters.GetProperty("itemId").GetString(), true));
    }
    private static string? Choice(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String) return value.GetString() switch { "accept" => "approve once", "acceptForSession" => "approve session", "decline" => "deny", "cancel" => "cancel turn", _ => null };
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != 1) return null;
        if (value.TryGetProperty("acceptWithExecpolicyAmendment", out var amendment) && Validation.Fields(amendment, ["execpolicy_amendment"]).IsSuccess)
        {
            var command = amendment.GetProperty("execpolicy_amendment");
            if (command.ValueKind == JsonValueKind.Array && command.GetArrayLength() is > 0 and <= 100 && command.EnumerateArray().All(part => Text(part, 4096))) return "apply command rule";
        }
        if (value.TryGetProperty("applyNetworkPolicyAmendment", out var network) && Validation.Fields(network, ["network_policy_amendment"]).IsSuccess)
        {
            var rule = network.GetProperty("network_policy_amendment");
            if (Validation.Fields(rule, ["host", "action"]).IsSuccess && Text(rule.GetProperty("host"), 255))
                return CodexJson.String(rule, "action") switch { "allow" => "allow network rule", "deny" => "deny network rule", _ => null };
        }
        return null;
    }
    public static JsonElement? Denial(RuntimeDecision decision)
        => decision.Choices.FirstOrDefault(choice => CodexJson.String(choice.Value, "decision") is "decline" or "cancel")?.Value;

    private static Result<RuntimeDecision> Question(NativeRequest request, string session)
    {
        var parameters = request.Parameters;
        if (!Attribution(parameters, session) || !parameters.TryGetProperty("questions", out var source) || source.ValueKind != JsonValueKind.Array || source.GetArrayLength() is < 1 or > 100)
            return Invalid("Invalid native question attribution");
        var questions = new List<DecisionQuestion>();
        foreach (var value in source.EnumerateArray())
        {
            if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("id", out var id) || !Text(id, 255)
                || !value.TryGetProperty("header", out var title) || !Text(title, 1000) || !value.TryGetProperty("question", out var prompt) || !Text(prompt, 16000, true)
                || !value.TryGetProperty("isOther", out var other) || !Validation.Boolean(other).IsSuccess || !value.TryGetProperty("isSecret", out var secret) || !Validation.Boolean(secret).IsSuccess
                || !value.TryGetProperty("options", out var options) || options.ValueKind is not (JsonValueKind.Null or JsonValueKind.Array)) return Invalid("Invalid native question");
            var choices = new List<DecisionOption>();
            if (options.ValueKind == JsonValueKind.Array)
            {
                if (options.GetArrayLength() > 100) return Invalid("Invalid native question option count");
                foreach (var option in options.EnumerateArray())
                {
                    if (option.ValueKind != JsonValueKind.Object || !option.TryGetProperty("label", out var label) || !Text(label, 1000)
                        || !option.TryGetProperty("description", out var description) || !Text(description, 4000, true)) return Invalid("Invalid native question option");
                    choices.Add(new(choices.Count.ToString(System.Globalization.CultureInfo.InvariantCulture), label.GetString()!, description.GetString()!));
                }
            }
            var name = id.GetString()!; if (questions.Any(question => question.Id == name)) return Invalid("Duplicate native question identity");
            questions.Add(new(name, title.GetString()!, prompt.GetString()!, secret.GetBoolean(), other.GetBoolean() || options.ValueKind == JsonValueKind.Null, choices));
        }
        if (!parameters.TryGetProperty("isBlocking", out var blocking) || !Validation.Boolean(blocking).IsSuccess) return Invalid("Invalid native question lifetime");
        long? expires = null;
        if (parameters.TryGetProperty("autoResolutionMs", out var duration) && duration.ValueKind != JsonValueKind.Null)
        { var parsed = Validation.Integer(duration); if (!parsed.IsSuccess) return Invalid("Invalid native question lifetime"); expires = parsed.Value; }
        var scope = CodexJson.Object(writer =>
        {
            writer.WriteStartArray("questions");
            foreach (var question in questions)
            {
                writer.WriteStartObject(); writer.WriteString("id", question.Id); writer.WriteString("title", question.Title); writer.WriteString("prompt", question.Prompt);
                writer.WriteBoolean("secret", question.Secret); writer.WriteBoolean("allowText", question.AllowText); writer.WriteStartArray("options");
                foreach (var option in question.Options) { writer.WriteStartObject(); writer.WriteString("id", option.Id); writer.WriteString("label", option.Label); writer.WriteString("description", option.Description); writer.WriteEndObject(); }
                writer.WriteEndArray(); writer.WriteEndObject();
            }
            writer.WriteEndArray();
        });
        return Result<RuntimeDecision>.Success(new("codex", session, CodexJson.DecisionIdentity(request.Id), "Human input", scope, [],
            parameters.GetProperty("turnId").GetString(), parameters.GetProperty("itemId").GetString(), blocking.GetBoolean(), expires, questions));
    }
    public static bool ValidAnswer(RuntimeDecision decision, JsonElement value)
    {
        if (decision.Questions is null) return decision.Choices.Any(choice => JsonElement.DeepEquals(choice.Value, value));
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("answers", out var answers) || answers.ValueKind != JsonValueKind.Object || answers.EnumerateObject().Count() != decision.Questions.Count) return false;
        return decision.Questions.All(question => answers.TryGetProperty(question.Id, out var answer) && answer.ValueKind == JsonValueKind.Object && answer.TryGetProperty("answers", out var selected)
            && selected.ValueKind == JsonValueKind.Array && selected.GetArrayLength() == 1 && selected[0].ValueKind == JsonValueKind.String
            && (question.AllowText || question.Options.Any(option => option.Label == selected[0].GetString())));
    }
}
