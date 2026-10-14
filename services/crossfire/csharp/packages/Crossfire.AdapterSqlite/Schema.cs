using System.Data.Common;
using System.Text.Json;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class Schema
{
    public const long ApplicationId = 1129465426;
    public const long Version = 17;

    public static Result<Unit> Initialize(CrossfireDbContext context)
    {
        context.Database.OpenConnection();
        var connection = context.Database.GetDbConnection();
        Execute(connection, "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;");
        var application = Scalar(connection, "PRAGMA application_id");
        var version = Scalar(connection, "PRAGMA user_version");
        if (application == ApplicationId && version == Version) return Results.Done();
        if (application == ApplicationId && version is 15 or 16)
        {
            using var source = typeof(Schema).Assembly.GetManifestResourceStream("Crossfire.Sqlite.Schema")
                ?? throw new InvalidOperationException("Canonical SQLite schema resource is missing");
            using var document = JsonDocument.Parse(source);
            SchemaMigration.AdvanceCurrentTables(context, version, document.RootElement);
            context.ChangeTracker.Clear();
            return Results.Done();
        }
        var existing = Scalar(connection, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        if (application != 0 || version != 0 || existing != 0)
            return Results.Fail<Unit>("invalid", "Unsupported Crossfire schema; no data was changed");

        using var resource = typeof(Schema).Assembly.GetManifestResourceStream("Crossfire.Sqlite.Schema")
            ?? throw new InvalidOperationException("Canonical SQLite schema resource is missing");
        using var definition = JsonDocument.Parse(resource);
        var root = definition.RootElement;
        if (root.GetProperty("application").GetInt64() != ApplicationId || root.GetProperty("version").GetInt64() != Version)
            throw new InvalidOperationException("Canonical SQLite schema identity differs from this adapter");
        using var transaction = context.Database.BeginTransaction();
        foreach (var item in root.GetProperty("initialization").EnumerateArray())
            context.Database.ExecuteSqlRaw(root.GetProperty("parts").GetProperty(item.GetString()!).GetString()!);
        context.Database.ExecuteSqlRaw("CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id)");
        ReferenceRows.Seed(context);
        context.Database.ExecuteSqlRaw("PRAGMA application_id = 1129465426; PRAGMA user_version = 17;");
        transaction.Commit();
        context.ChangeTracker.Clear();
        return Results.Done();
    }

    private static long Scalar(DbConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void Execute(DbConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
