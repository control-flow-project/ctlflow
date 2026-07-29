using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal static partial class JsonWebTokens
{
    internal static string ReadRequiredString(
        JsonElement value,
        string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.String
            || property.GetString() is not { } result)
        {
            throw new TokenValidationException();
        }

        return result;
    }
}
