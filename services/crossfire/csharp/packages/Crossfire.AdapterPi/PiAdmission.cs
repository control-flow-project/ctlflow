using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed record PiAdmissionResult(JsonElement State, IReadOnlyList<RuntimeSetting> Settings);

public static class PiAdmission
{
    public static async ValueTask<Result<PiAdmissionResult>> Read(PiProtocol native, PiOptions options, CancellationToken cancellation)
    {
        var available = PiValues.ObjectReply(await native.Request("get_available_models", PiValues.Empty(), cancellation)); if (!available.IsSuccess) return Result<PiAdmissionResult>.Fail(available.Error);
        if (!available.Value.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array || models.GetArrayLength() > 20000 || models.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.Object))
            return Results.Fail<PiAdmissionResult>("invalid", "Invalid native Pi model availability");
        if (options.Model is not null)
        {
            if (!models.EnumerateArray().Any(value => PiValues.Text(value, "provider") == options.Provider && PiValues.Text(value, "id") == options.Model))
                return Results.Fail<PiAdmissionResult>("invalid", "Unavailable Pi model " + options.Provider + "/" + options.Model + "; no substitution was made");
            var selected = await native.Request("set_model", PiValues.Object(writer => { writer.WriteString("provider", options.Provider); writer.WriteString("modelId", options.Model); }), cancellation);
            if (!selected.IsSuccess) return Result<PiAdmissionResult>.Fail(selected.Error);
            if (PiValues.Text(selected.Value, "provider") != options.Provider || PiValues.Text(selected.Value, "id") != options.Model) return Results.Fail<PiAdmissionResult>("conflict", "Pi substituted the configured model");
        }
        var availableLevels = PiValues.ObjectReply(await native.Request("get_available_thinking_levels", PiValues.Empty(), cancellation)); if (!availableLevels.IsSuccess) return Result<PiAdmissionResult>.Fail(availableLevels.Error);
        if (!availableLevels.Value.TryGetProperty("levels", out var levels) || levels.ValueKind != JsonValueKind.Array || levels.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String))
            return Results.Fail<PiAdmissionResult>("invalid", "Invalid native Pi thinking levels");
        if (options.Thinking is not null)
        {
            if (!levels.EnumerateArray().Any(value => value.GetString() == options.Thinking)) return Results.Fail<PiAdmissionResult>("invalid", "Pi model does not support thinking_level=" + options.Thinking + "; no clamping or substitution was made");
            var selected = await native.Request("set_thinking_level", PiValues.Object(writer => writer.WriteString("level", options.Thinking)), cancellation); if (!selected.IsSuccess) return Result<PiAdmissionResult>.Fail(selected.Error);
        }
        var response = PiValues.ObjectReply(await native.Request("get_state", PiValues.Empty(), cancellation)); if (!response.IsSuccess) return Result<PiAdmissionResult>.Fail(response.Error); var state = response.Value;
        if (!state.TryGetProperty("model", out var model) || model.ValueKind != JsonValueKind.Object || PiValues.Text(model, "provider") is not { } provider || PiValues.Text(model, "id") is not { } id
            || PiValues.Text(state, "thinkingLevel") is not { } thinking || !models.EnumerateArray().Any(value => PiValues.Text(value, "provider") == provider && PiValues.Text(value, "id") == id)
            || options.Model is not null && (id != options.Model || provider != options.Provider) || options.Thinking is not null && thinking != options.Thinking)
            return Results.Fail<PiAdmissionResult>("conflict", "Pi effective settings differ from native admission");
        return Result<PiAdmissionResult>.Success(new(state, [new("provider", options.Provider, provider), new("model", options.Model, id), new("thinking_level", options.Thinking, thinking), new("native_version", null, native.Version)]));
    }
}
