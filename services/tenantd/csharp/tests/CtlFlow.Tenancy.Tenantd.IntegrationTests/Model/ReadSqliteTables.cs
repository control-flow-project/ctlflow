using System.Data.Common;

namespace CtlFlow.Tenancy.Tenantd.IntegrationTests.Model;

internal static partial class ModelAudits
{
    internal static async Task<IReadOnlyDictionary<string, SqliteTable>>
        ReadSqliteTables(
            DbConnection connection,
            CancellationToken cancellation)
    {
        var names = await ReadTableNames(connection, cancellation);
        var tables = new Dictionary<string, SqliteTable>(
            names.Count,
            StringComparer.Ordinal);
        foreach (var name in names)
        {
            tables.Add(
                name,
                new SqliteTable(
                    name,
                    await ReadColumns(connection, name, cancellation),
                    await ReadForeignKeys(connection, name, cancellation),
                    await ReadIndexes(connection, name, cancellation)));
        }

        return tables;
    }

    private static async Task<IReadOnlyList<string>> ReadTableNames(
        DbConnection connection,
        CancellationToken cancellation)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT name FROM sqlite_schema "
            + "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            + "ORDER BY name";
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        var names = new List<string>();
        while (await reader.ReadAsync(cancellation))
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    private static async Task<IReadOnlyDictionary<string, SqliteColumn>>
        ReadColumns(
            DbConnection connection,
            string table,
            CancellationToken cancellation)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_xinfo({Quote(table)})";
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        var columns = new Dictionary<string, SqliteColumn>(
            StringComparer.Ordinal);
        while (await reader.ReadAsync(cancellation))
        {
            var hidden = reader.GetInt32(6);
            Require(hidden == 0, $"SQLite table {table} has a hidden column");
            var name = reader.GetString(1);
            var primaryKeyOrder = reader.GetInt32(5);
            columns.Add(
                name,
                new SqliteColumn(
                    name,
                    GetSqliteAffinity(reader.GetString(2)),
                    reader.GetInt32(3) != 0 || primaryKeyOrder > 0,
                    primaryKeyOrder));
        }

        return columns;
    }

    private static async Task<IReadOnlyList<SqliteForeignKey>>
        ReadForeignKeys(
            DbConnection connection,
            string table,
            CancellationToken cancellation)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA foreign_key_list({Quote(table)})";
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        var rows = new List<ForeignKeyRow>();
        while (await reader.ReadAsync(cancellation))
        {
            rows.Add(new ForeignKeyRow(
                reader.GetInt32(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(6)));
        }

        return rows
            .GroupBy(row => row.Id)
            .Select(group =>
            {
                var ordered = group.OrderBy(row => row.Sequence).ToArray();
                return new SqliteForeignKey(
                    table,
                    ordered.Select(row => row.Column).ToArray(),
                    ordered[0]!.PrincipalTable,
                    ordered.Select(row => row.PrincipalColumn).ToArray(),
                    ordered[0]!.OnDelete.ToUpperInvariant());
            })
            .OrderBy(value => value.Signature, StringComparer.Ordinal)
            .ToArray();
    }

    private static async Task<IReadOnlyList<SqliteIndex>> ReadIndexes(
        DbConnection connection,
        string table,
        CancellationToken cancellation)
    {
        var entries = new List<IndexRow>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"PRAGMA index_list({Quote(table)})";
            await using var reader =
                await command.ExecuteReaderAsync(cancellation);
            while (await reader.ReadAsync(cancellation))
            {
                if (reader.GetString(3) == "pk")
                {
                    continue;
                }

                entries.Add(new IndexRow(
                    reader.GetString(1),
                    reader.GetInt32(2) != 0));
            }
        }

        var indexes = new List<SqliteIndex>(entries.Count);
        foreach (var entry in entries)
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                $"PRAGMA index_info({Quote(entry.Name)})";
            await using var reader =
                await command.ExecuteReaderAsync(cancellation);
            var columns = new List<(int Order, string Name)>();
            while (await reader.ReadAsync(cancellation))
            {
                columns.Add((reader.GetInt32(0), reader.GetString(2)));
            }

            indexes.Add(new SqliteIndex(
                entry.Unique,
                columns
                    .OrderBy(value => value.Order)
                    .Select(value => value.Name)
                    .ToArray()));
        }

        return indexes
            .OrderBy(value => value.Signature, StringComparer.Ordinal)
            .ToArray();
    }

    private static string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static string GetSqliteAffinity(string declaredType)
    {
        var type = declaredType.ToUpperInvariant();
        if (type.Contains("INT", StringComparison.Ordinal))
        {
            return "INTEGER";
        }
        if (type.Contains("CHAR", StringComparison.Ordinal)
            || type.Contains("CLOB", StringComparison.Ordinal)
            || type.Contains("TEXT", StringComparison.Ordinal))
        {
            return "TEXT";
        }
        if (type.Contains("BLOB", StringComparison.Ordinal)
            || type.Length == 0)
        {
            return "BLOB";
        }
        if (type.Contains("REAL", StringComparison.Ordinal)
            || type.Contains("FLOA", StringComparison.Ordinal)
            || type.Contains("DOUB", StringComparison.Ordinal))
        {
            return "REAL";
        }

        return "NUMERIC";
    }

    private sealed record ForeignKeyRow(
        int Id,
        int Sequence,
        string PrincipalTable,
        string Column,
        string PrincipalColumn,
        string OnDelete);

    private sealed record IndexRow(string Name, bool Unique);
}
