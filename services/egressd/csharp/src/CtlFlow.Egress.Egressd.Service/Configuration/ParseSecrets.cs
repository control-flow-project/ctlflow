using System.Text.Json;
using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static async Task<SecretValues> ParseSecrets(
        string path,
        CancellationToken cancellation)
    {
        using var document = await ReadStrictJsonDocument(
            path,
            "Egressd secrets document",
            cancellation);
        var root = document.RootElement;
        RequireProperties(
            root,
            new HashSet<string>(
                ["schema_version", "values"],
                StringComparer.Ordinal));
        if (ReadInteger(root, "schema_version") != 1)
        {
            throw new InvalidOperationException(
                "Egressd secrets schema version is invalid");
        }

        var values = new Dictionary<SecretName, SecretValue>();
        foreach (var item in ReadArray(root, "values", 0, 256)
            .EnumerateArray())
        {
            RequireProperties(
                item,
                new HashSet<string>(
                    ["name", "value"],
                    StringComparer.Ordinal));
            var name = await SecretName.Parse(
                ReadString(item, "name"),
                cancellation);
            var material = ReadString(item, "value");
            if (!IsPrintableHeaderValue(material)
                || !values.TryAdd(name, new SecretValue(material)))
            {
                throw new InvalidOperationException(
                    "Egressd secret value is invalid");
            }
        }

        return new SecretValues(values);
    }

    internal static bool IsPrintableHeaderValue(string value)
    {
        if (value.Length is < 1 or > 8_192)
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is < ' ' or > '~')
            {
                return false;
            }
        }

        return true;
    }
}
