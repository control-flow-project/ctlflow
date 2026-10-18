using Crossfire.AdapterSqlite;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Crossfire.Storage.Tests;

public static class SchemaAcceptance
{
    public static bool Run(string[] arguments)
    {
        if (arguments is ["--backup", var directory])
        {
            if (!Path.IsPathFullyQualified(directory)) throw new ArgumentException("Select an absolute existing database directory");
            var file = DatabaseUpgrade.BackupBeforeMigration(directory);
            Console.WriteLine(JsonSerializer.Serialize(new SchemaBackup(file, RuntimeFeature.IsDynamicCodeSupported,
                JsonSerializer.IsReflectionEnabledByDefault), SchemaJson.Default.SchemaBackup));
            return true;
        }
        if (arguments.Length != 2 || arguments[0] != "--validate") return false;
        if (!Path.IsPathFullyQualified(arguments[1])) throw new ArgumentException("Select an absolute existing database");
        using var context = new CrossfireDbContext(DatabaseConnections.Options(arguments[1]));
        var validation = Schema.Validate(context);
        Console.WriteLine(JsonSerializer.Serialize(new SchemaResult(validation.IsSuccess ? "passed" : "rejected",
            validation.IsSuccess ? null : validation.Error.Message, RuntimeFeature.IsDynamicCodeSupported,
            JsonSerializer.IsReflectionEnabledByDefault), SchemaJson.Default.SchemaResult));
        return true;
    }
}

public sealed record SchemaResult(string Status, string? Error, bool DynamicCode, bool ReflectionJson);
public sealed record SchemaBackup(string? File, bool DynamicCode, bool ReflectionJson);

[JsonSerializable(typeof(SchemaResult))]
[JsonSerializable(typeof(SchemaBackup))]
partial class SchemaJson : JsonSerializerContext;
