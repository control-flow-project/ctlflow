using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public static class PiProvider
{
    public static Result<ProviderState> Parse(JsonElement state, JsonElement available)
    {
        if (state.ValueKind != JsonValueKind.Object || !state.TryGetProperty("model", out var model) || model.ValueKind != JsonValueKind.Object
            || PiValues.Text(model, "provider") is not { } provider || PiValues.Text(model, "id") is not { } id
            || available.ValueKind != JsonValueKind.Object || !available.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array || models.GetArrayLength() > 20000)
            return Results.Fail<ProviderState>("native", "Native provider metadata is invalid");
        var present = false;
        foreach (var value in models.EnumerateArray())
        {
            if (value.ValueKind != JsonValueKind.Object || PiValues.Text(value, "provider") is not { } candidateProvider || PiValues.Text(value, "id") is not { } candidateId)
                return Results.Fail<ProviderState>("native", "Native provider metadata is invalid");
            present |= candidateProvider == provider && candidateId == id;
        }
        return Result<ProviderState>.Success(present ? ProviderState.Present : ProviderState.Missing);
    }
}
