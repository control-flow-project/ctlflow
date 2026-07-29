using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static void RequireProperties(
        JsonElement value,
        IReadOnlySet<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("Expected an object");
        }

        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!actual.Add(property.Name)
                || !expected.Contains(property.Name))
            {
                throw new InvalidDataException(
                    "Object properties are invalid");
            }
        }

        if (!actual.SetEquals(expected))
        {
            throw new InvalidDataException(
                "Required object properties are missing");
        }
    }
}
