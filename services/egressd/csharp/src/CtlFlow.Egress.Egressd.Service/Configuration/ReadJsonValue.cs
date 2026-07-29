using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static string ReadString(
        JsonElement value,
        string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.String
            || property.GetString() is not { } result)
        {
            throw new InvalidDataException($"{name} is invalid");
        }

        return result;
    }

    internal static int ReadInteger(
        JsonElement value,
        string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.Number
            || !property.TryGetInt32(out var result))
        {
            throw new InvalidDataException($"{name} is invalid");
        }

        return result;
    }

    internal static bool ReadBoolean(
        JsonElement value,
        string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind is not (
                JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException($"{name} is invalid");
        }

        return property.GetBoolean();
    }

    internal static JsonElement ReadArray(
        JsonElement value,
        string name,
        int minimum,
        int maximum)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.Array
            || property.GetArrayLength() < minimum
            || property.GetArrayLength() > maximum)
        {
            throw new InvalidDataException($"{name} is invalid");
        }

        return property;
    }

    internal static JsonElement ReadObject(
        JsonElement value,
        string name)
    {
        if (!value.TryGetProperty(name, out var property)
            || property.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"{name} is invalid");
        }

        return property;
    }
}
