using System.Text.Json;

namespace CtlFlow.Audit.Auditd.Service.Security.Tokens;

internal static partial class JsonWebTokens
{
    internal static string ReadRequiredString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.String
            || property.GetString() is not { } result)
        {
            throw new TokenValidationException();
        }

        return result;
    }

    internal static string? ReadOptionalString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property))
        {
            return null;
        }

        return property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : throw new TokenValidationException();
    }
}
