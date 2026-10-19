using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class CodexProvider
{
    public static Result<ProviderState> Parse(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("account", out var account)
            || account.ValueKind is not (JsonValueKind.Null or JsonValueKind.Object)
            || !value.TryGetProperty("requiresOpenaiAuth", out var required) || required.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            return Results.Fail<ProviderState>("native", "Native provider metadata is invalid");
        return Result<ProviderState>.Success(account.ValueKind == JsonValueKind.Object ? ProviderState.Present : required.GetBoolean() ? ProviderState.Missing : ProviderState.NotRequired);
    }
}
