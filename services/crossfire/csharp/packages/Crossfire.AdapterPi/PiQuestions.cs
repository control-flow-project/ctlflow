using System.Globalization;
using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public static class PiQuestions
{
    public static bool IsQuestion(JsonElement input) => PiValues.Text(input, "type") == "extension_ui_request" && PiValues.Text(input, "method") is "confirm" or "select" or "input" or "editor";
    public static Result<RuntimeDecision> Decode(JsonElement input, string session, string turn)
    {
        var id = PiValues.Text(input, "id"); var title = PiValues.Text(input, "title"); var method = PiValues.Text(input, "method");
        if (!IsQuestion(input) || id is null || title is null || !Validation.Text(input.GetProperty("id")).IsSuccess)
            return Results.Fail<RuntimeDecision>("invalid", "Invalid native Pi question identity or method");
        string[] choices;
        if (method == "confirm") choices = ["Yes", "No"];
        else if (method == "select")
        {
            if (!input.TryGetProperty("options", out var options) || options.ValueKind != JsonValueKind.Array || options.GetArrayLength() > 100 || options.EnumerateArray().Any(value => !Validation.Text(value, 1000).IsSuccess))
                return Results.Fail<RuntimeDecision>("invalid", "Invalid native Pi question options");
            choices = options.EnumerateArray().Select(value => value.GetString()!).ToArray();
        }
        else choices = [];
        if (choices.Distinct(StringComparer.Ordinal).Count() != choices.Length) return Results.Fail<RuntimeDecision>("invalid", "Duplicate native Pi question options");
        var separator = title.IndexOf('\n'); var heading = separator < 0 ? title : title[..separator];
        var prompt = PiValues.Text(input, "message") ?? PiValues.Text(input, "placeholder") ?? PiValues.Text(input, "prefill") ?? (separator < 0 ? title : title[(separator + 1)..]);
        var text = PiValues.Object(writer => { writer.WriteString("title", heading); writer.WriteString("prompt", prompt); });
        if (!Validation.Text(text.GetProperty("title"), 1000).IsSuccess || !Validation.PlainText(text.GetProperty("prompt"), 16000).IsSuccess)
            return Results.Fail<RuntimeDecision>("invalid", "Pi question exceeds the native decision contract");
        long? expires = null;
        if (input.TryGetProperty("timeout", out var timeout)) { var parsed = Validation.Integer(timeout, 0, int.MaxValue); if (!parsed.IsSuccess) return Result<RuntimeDecision>.Fail(parsed.Error); if (parsed.Value != 0) expires = parsed.Value; }
        var question = new DecisionQuestion(id, heading, prompt, false, method is "input" or "editor", choices.Select((label, index) => new DecisionOption(index.ToString(CultureInfo.InvariantCulture), label, "")).ToArray());
        var scope = PiValues.Object(writer =>
        {
            writer.WriteString("method", method); writer.WriteStartArray("questions"); writer.WriteStartObject(); writer.WriteString("id", id); writer.WriteString("title", heading); writer.WriteString("prompt", prompt);
            writer.WriteBoolean("secret", false); writer.WriteBoolean("allowText", question.AllowText); writer.WriteStartArray("options");
            foreach (var option in question.Options) { writer.WriteStartObject(); writer.WriteString("id", option.Id); writer.WriteString("label", option.Label); writer.WriteString("description", option.Description); writer.WriteEndObject(); }
            writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndArray();
        });
        return Result<RuntimeDecision>.Success(new("pi", session, id, "Human input", scope, [], turn, id, true, expires, [question]));
    }
    public static async ValueTask<Result<Unit>> Answer(PiProtocol native, RuntimeHooks hooks, RuntimeDecision decision, CancellationToken cancellation)
    {
        var result = await hooks.RequestDecision(decision, cancellation); cancellation.ThrowIfCancellationRequested();
        if (!result.IsSuccess) return await Cancel(native, decision.Request);
        var value = result.Value;
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("answers", out var answers) || answers.ValueKind != JsonValueKind.Object || answers.EnumerateObject().Count() != 1
            || !answers.TryGetProperty(decision.Request, out var selected) || selected.ValueKind != JsonValueKind.Object || !selected.TryGetProperty("answers", out var answer)
            || answer.ValueKind != JsonValueKind.Array || answer.GetArrayLength() != 1 || answer[0].ValueKind != JsonValueKind.String)
            return Results.Fail<Unit>("invalid", "Owner answer does not match the original Pi question");
        var text = answer[0].GetString()!; var question = decision.Questions![0];
        if (!question.AllowText && !question.Options.Any(option => option.Label == text)) return Results.Fail<Unit>("invalid", "Owner answer is not a native Pi choice");
        var notified = await native.Notify(PiValues.Object(writer => { writer.WriteString("type", "extension_ui_response"); writer.WriteString("id", decision.Request);
            if (PiValues.Text(decision.Scope, "method") == "confirm") writer.WriteBoolean("confirmed", text == "Yes"); else writer.WriteString("value", text); }), cancellation);
        if (notified.IsSuccess) hooks.DecisionResponded?.Invoke(decision); return notified;
    }
    public static ValueTask<Result<Unit>> Cancel(PiProtocol native, string request)
        => native.Notify(PiValues.Object(writer => { writer.WriteString("type", "extension_ui_response"); writer.WriteString("id", request); writer.WriteBoolean("cancelled", true); }));
}
