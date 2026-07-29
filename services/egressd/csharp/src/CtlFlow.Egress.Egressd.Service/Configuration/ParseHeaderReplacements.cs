using System.Text.Json;
using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static async Task<IReadOnlyList<RequestHeaderReplacement>>
        ParseHeaderReplacements(
            JsonElement rule,
            CancellationToken cancellation)
    {
        var names = new HashSet<HeaderName>();
        var replacements = new List<RequestHeaderReplacement>();
        foreach (var item in ReadArray(
            rule,
            "set_request_headers",
            0,
            128).EnumerateArray())
        {
            RequireProperties(
                item,
                new HashSet<string>(
                    ["name", "value"],
                    StringComparer.Ordinal));
            var name = await HeaderName.Parse(
                ReadString(item, "name"),
                cancellation);
            if (IsProtectedHeader(name.Value, requestHeaders: true)
                || !names.Add(name))
            {
                throw new InvalidOperationException(
                    "set_request_headers is invalid");
            }

            replacements.Add(new RequestHeaderReplacement(
                name,
                await ParseHeaderValue(
                    ReadObject(item, "value"),
                    cancellation)));
        }

        return replacements;
    }

    private static async ValueTask<RequestHeaderValue> ParseHeaderValue(
        JsonElement value,
        CancellationToken cancellation)
    {
        var properties = value.EnumerateObject().ToArray();
        if (properties.Length != 1)
        {
            throw new InvalidDataException(
                "Header replacement value is invalid");
        }

        var property = properties[0];
        if (property.Value.ValueKind != JsonValueKind.String
            || property.Value.GetString() is not { } material)
        {
            throw new InvalidDataException(
                "Header replacement value is invalid");
        }

        return property.Name switch
        {
            "literal" when IsPrintableHeaderValue(material) =>
                new RequestHeaderValue.Literal(material),
            "secret_name" => new RequestHeaderValue.Secret(
                await SecretName.Parse(material, cancellation)),
            _ => throw new InvalidDataException(
                "Header replacement value is invalid")
        };
    }
}
