using System.Data.Common;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Crossfire.AdapterSqlite;

internal static partial class SchemaMigration
{
    [SuppressMessage("Security", "EF1003", Justification = "Forward schema DDL only: table identifiers are compile-time closed lists; index identifiers match [a-z_]+ in the embedded canonical schema. No request values enter SQL.")]
    internal static void AdvanceCurrentTables(CrossfireDbContext context, long version, JsonElement definition)
    {
        var connection = context.Database.GetDbConnection();
        Execute(connection, "PRAGMA foreign_keys=OFF");
        try
        {
            using var transaction = context.Database.BeginTransaction();
            if (version == 15)
            {
                var source = definition.GetProperty("parts").GetProperty("statisticsSchema").GetString()!;
                foreach (var table in new[] { "listener_stat_usage", "runtime_usage_checkpoint" })
                {
                    var sql = Table(source, table);
                    var temporary = IndexPattern().Replace(sql.Replace("CREATE TABLE " + table, "CREATE TABLE " + table + "_next", StringComparison.Ordinal)
                        .Replace("ON " + table + "(", "ON " + table + "_next(", StringComparison.Ordinal), "CREATE INDEX $1_next");
                    context.Database.ExecuteSqlRaw(temporary);
                    context.Database.ExecuteSqlRaw("INSERT INTO " + table + "_next SELECT * FROM " + table + "; DROP TABLE " + table + "; ALTER TABLE " + table + "_next RENAME TO " + table + ";");
                    foreach (Match index in FullIndexPattern().Matches(sql))
                        context.Database.ExecuteSqlRaw("DROP INDEX " + index.Groups[1].Value + "_next; " + index.Value);
                }
                AssertForeignKeys(connection, transaction.GetDbTransaction());
            }
            foreach (var table in new[] { "enrollment_archive", "enrollment_archive_item", "enrollment_archive_policy", "enrollment_archive_permission", "enrollment_archive_wake_sender", "enrollment_archive_metadata" })
                context.Database.ExecuteSqlRaw("DROP TRIGGER IF EXISTS protect_" + table + "_delete;");
            context.Database.ExecuteSqlRaw(definition.GetProperty("parts").GetProperty("loggingSchema").GetString()!);
            AssertForeignKeys(connection, transaction.GetDbTransaction());
            context.Database.ExecuteSqlRaw("PRAGMA user_version=17");
            transaction.Commit();
        }
        finally { Execute(connection, "PRAGMA foreign_keys=ON"); }
    }

    private static string Table(string source, string table)
    {
        var start = source.IndexOf("CREATE TABLE " + table + " (", StringComparison.Ordinal);
        if (start < 0) throw new InvalidOperationException("Missing canonical table schema");
        var end = source.IndexOf("CREATE TABLE ", start + 1, StringComparison.Ordinal);
        return (end < 0 ? source[start..] : source[start..end]).Trim();
    }

    private static void AssertForeignKeys(DbConnection connection, DbTransaction transaction)
    {
        using var command = connection.CreateCommand(); command.CommandText = "PRAGMA foreign_key_check"; command.Transaction = transaction;
        using var reader = command.ExecuteReader();
        if (reader.Read()) throw new InvalidOperationException("Schema migration would violate preserved relationships");
    }

    private static void Execute(DbConnection connection, string sql)
    { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }

    [GeneratedRegex("CREATE INDEX ([a-z_]+)", RegexOptions.CultureInvariant)]
    private static partial Regex IndexPattern();
    [GeneratedRegex("CREATE INDEX ([a-z_]+)[^;]+;", RegexOptions.CultureInvariant)]
    private static partial Regex FullIndexPattern();
}
