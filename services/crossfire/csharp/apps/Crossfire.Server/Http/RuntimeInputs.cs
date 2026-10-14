using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class RuntimeInputs
{
    public static Result<DecisionCreation> Decision(JsonElement input)
    {
        var fields = Validation.Fields(input, ["id", "runId", "runtime", "sessionId", "requestId", "turnId", "itemId", "kind", "action", "review", "blocking", "expiresAt", "questions"]);
        if (!fields.IsSuccess) return Result<DecisionCreation>.Fail(fields.Error);
        var id = Inputs.Id(input, "id"); var run = Inputs.Id(input, "runId"); var runtime = Validation.Choice(input.GetProperty("runtime"), "codex", "pi");
        var session = Validation.Text(input.GetProperty("sessionId")); var request = Validation.Text(input.GetProperty("requestId"));
        var turn = Validation.Text(input.GetProperty("turnId")); var item = Validation.Text(input.GetProperty("itemId")); var kind = Validation.Choice(input.GetProperty("kind"), "permission", "question");
        var action = Validation.Text(input.GetProperty("action")); var review = Validation.PlainText(input.GetProperty("review"), 8388608);
        var blocking = Validation.Boolean(input.GetProperty("blocking")); var expires = Validation.NullableInteger(input.GetProperty("expiresAt"));
        var questions = Validation.List(input.GetProperty("questions"), Question, 100, 1);
        return !id.IsSuccess || !run.IsSuccess || !runtime.IsSuccess || !session.IsSuccess || !request.IsSuccess || !turn.IsSuccess || !item.IsSuccess
            || !kind.IsSuccess || !action.IsSuccess || !review.IsSuccess || !blocking.IsSuccess || !expires.IsSuccess || !questions.IsSuccess
            ? Results.Fail<DecisionCreation>("invalid", "Invalid bounded native decision") : Result<DecisionCreation>.Success(new(id.Value, run.Value, runtime.Value,
                session.Value, request.Value, turn.Value, item.Value, kind.Value, action.Value, review.Value, blocking.Value, expires.Value, questions.Value));
    }

    private static Result<DecisionQuestion> Question(JsonElement input)
    {
        var fields = Validation.Fields(input, ["id", "title", "prompt", "secret", "allowText", "options"]); if (!fields.IsSuccess) return Result<DecisionQuestion>.Fail(fields.Error);
        var id = Validation.Text(input.GetProperty("id")); var title = Validation.Text(input.GetProperty("title"), 1000); var prompt = Validation.PlainText(input.GetProperty("prompt"), 16000);
        var secret = Validation.Boolean(input.GetProperty("secret")); var text = Validation.Boolean(input.GetProperty("allowText")); var options = Validation.List(input.GetProperty("options"), Option, 100);
        return !id.IsSuccess || !title.IsSuccess || !prompt.IsSuccess || !secret.IsSuccess || !text.IsSuccess || !options.IsSuccess ? Results.Fail<DecisionQuestion>("invalid", "Invalid native question")
            : Result<DecisionQuestion>.Success(new(id.Value, title.Value, prompt.Value, secret.Value, text.Value, options.Value));
    }

    private static Result<DecisionOption> Option(JsonElement input)
    {
        var fields = Validation.Fields(input, ["id", "label", "description"]); if (!fields.IsSuccess) return Result<DecisionOption>.Fail(fields.Error);
        var id = Validation.Text(input.GetProperty("id")); var label = Validation.Text(input.GetProperty("label"), 1000); var description = Validation.PlainText(input.GetProperty("description"), 4000);
        return !id.IsSuccess || !label.IsSuccess || !description.IsSuccess ? Results.Fail<DecisionOption>("invalid", "Invalid native option")
            : Result<DecisionOption>.Success(new(id.Value, label.Value, description.Value));
    }

    public static Result<IReadOnlyList<DecisionAnswer>> Answers(JsonElement input)
    {
        var fields = Validation.Fields(input, ["answers"]); if (!fields.IsSuccess) return Result<IReadOnlyList<DecisionAnswer>>.Fail(fields.Error);
        return Validation.List(input.GetProperty("answers"), value =>
        {
            var properties = Validation.Fields(value, ["questionId", "optionId", "text"]); if (!properties.IsSuccess) return Result<DecisionAnswer>.Fail(properties.Error);
            var question = Validation.Text(value.GetProperty("questionId")); var option = Validation.NullableText(value.GetProperty("optionId"));
            var text = value.GetProperty("text").ValueKind == JsonValueKind.Null ? Result<string?>.Success(null) : Validation.PlainText(value.GetProperty("text"), 16000).Map<string?>(parsed => parsed);
            return !question.IsSuccess || !option.IsSuccess || !text.IsSuccess ? Results.Fail<DecisionAnswer>("invalid", "Invalid native answer") : Result<DecisionAnswer>.Success(new(question.Value, option.Value, text.Value));
        }, 100, 1);
    }

    public static Result<RuntimeObservation> Observation(JsonElement input, string runId)
    {
        var fields = Validation.Fields(input, ["sessionId", "roomId", "runtime", "state", "observedAt", "lastActivityAt", "historyAvailable", "historyMode", "maxInputBytes", "settings", "errorMessage"]);
        if (!fields.IsSuccess) return Result<RuntimeObservation>.Fail(fields.Error);
        var session = Validation.Text(input.GetProperty("sessionId")); var room = Validation.NullableText(input.GetProperty("roomId"));
        var runtime = Validation.Choice(input.GetProperty("runtime"), "codex", "pi"); var status = Validation.Choice(input.GetProperty("state"), "idle", "working", "waiting-approval", "waiting-answer", "failed", "unavailable", "sleeping", "waking");
        var observed = Validation.Integer(input.GetProperty("observedAt")); var active = Validation.NullableInteger(input.GetProperty("lastActivityAt")); var history = Validation.NullableBoolean(input.GetProperty("historyAvailable"));
        var mode = Validation.Choice(input.GetProperty("historyMode"), "shared", "per-room"); var size = Validation.Integer(input.GetProperty("maxInputBytes"), 1024, 4194304);
        var settings = Validation.List(input.GetProperty("settings"), Setting, 100);
        var error = input.GetProperty("errorMessage").ValueKind == JsonValueKind.Null ? Result<string?>.Success(null) : Validation.PlainText(input.GetProperty("errorMessage"), 4000).Map<string?>(parsed => parsed);
        return !session.IsSuccess || !room.IsSuccess || room.Value is not null && !Validation.RoomId(room.Value) || !runtime.IsSuccess || !status.IsSuccess || !observed.IsSuccess
            || !active.IsSuccess || !history.IsSuccess || !mode.IsSuccess || !size.IsSuccess || !settings.IsSuccess || !error.IsSuccess ? Results.Fail<RuntimeObservation>("invalid", "Invalid native runtime observation")
            : Result<RuntimeObservation>.Success(new(runId, session.Value, room.Value, runtime.Value, status.Value, observed.Value, active.Value, history.Value, mode.Value, size.Value, settings.Value, error.Value));
    }

    private static Result<RuntimeSetting> Setting(JsonElement input)
    {
        var fields = Validation.Fields(input, ["name", "configured", "effective"]); if (!fields.IsSuccess) return Result<RuntimeSetting>.Fail(fields.Error);
        var name = Validation.Text(input.GetProperty("name"), 100); var configured = Validation.NullableText(input.GetProperty("configured"), 1000); var effective = Validation.NullableText(input.GetProperty("effective"), 1000);
        return !name.IsSuccess || !configured.IsSuccess || !effective.IsSuccess ? Results.Fail<RuntimeSetting>("invalid", "Invalid public runtime setting") : Result<RuntimeSetting>.Success(new(name.Value, configured.Value, effective.Value));
    }
}
