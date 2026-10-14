using System.Text;
using System.Collections;
using Crossfire.Kernel;
using CsToml;
using CsToml.Error;

namespace Crossfire.AdapterToml;

public static class ConfigurationToml
{
    public const int MaximumBytes = 1048576;
    private static readonly CsTomlSerializerOptions Options = CsTomlSerializerOptions.Default with { Spec = TomlSpec.Version110 };
    public static Result<Dictionary<string, object?>> Parse(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > MaximumBytes) return Results.Fail<Dictionary<string, object?>>("invalid", "Configuration exceeds its finite TOML byte bound");
        try
        {
            var model = CsTomlSerializer.Deserialize<Dictionary<string, object?>>(Encoding.UTF8.GetBytes(text), Options);
            return Result<Dictionary<string, object?>>.Success((Dictionary<string, object?>)Normalize(model, 0)!);
        }
        catch (Exception error) when (error is CsTomlException or InvalidDataException) { return Results.Fail<Dictionary<string, object?>>("invalid", "Invalid native TOML configuration"); }
    }
    private static object? Normalize(object? value, int depth)
    {
        if (depth > 64) throw new InvalidDataException("Native configuration nesting exceeds its finite depth bound");
        if (value is IDictionary dictionary)
        {
            var result = new Dictionary<string, object?>(dictionary.Count, StringComparer.Ordinal);
            foreach (DictionaryEntry entry in dictionary)
            { if (entry.Key is not string name) throw new InvalidDataException("TOML keys must be text"); result.Add(name, Normalize(entry.Value, depth + 1)); }
            return result;
        }
        if (value is object?[] array) return array.Select(item => Normalize(item, depth + 1)).ToArray();
        return value;
    }
    public static Result<string> Format(Dictionary<string, object?> table)
    {
        try
        {
            using var encoded = CsTomlSerializer.Serialize(table, Options); var text = Encoding.UTF8.GetString(encoded.ByteSpan);
            return Encoding.UTF8.GetByteCount(text) <= MaximumBytes ? Result<string>.Success(text) : Results.Fail<string>("invalid", "Configuration exceeds its finite TOML byte bound");
        }
        catch (CsTomlException) { return Results.Fail<string>("invalid", "Configuration cannot be represented as native TOML"); }
    }
}
