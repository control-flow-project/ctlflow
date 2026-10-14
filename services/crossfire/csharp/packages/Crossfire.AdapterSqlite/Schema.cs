using System.Data.Common;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class Schema
{
    public static Result<Unit> Validate(CrossfireDbContext context)
    {
        context.Database.OpenConnection();
        var connection = context.Database.GetDbConnection();
        if (Scalar(connection, "PRAGMA application_id") != SchemaContract.ApplicationId
            || Scalar(connection, "PRAGMA user_version") != SchemaContract.Version)
            return Results.Fail<Unit>("invalid", "Unsupported Crossfire schema; run the Knex migration container before starting the server. No data was changed");
        if (Scalar(connection, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='knex_migrations'") != 1)
            return Results.Fail<Unit>("invalid", "Management database has not been migrated by Knex; run the migration container");
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM knex_migrations ORDER BY name";
        using var reader = command.ExecuteReader();
        foreach (var name in SchemaContract.Migrations)
            if (!reader.Read() || reader.GetString(0) != name)
                return Results.Fail<Unit>("invalid", "Management database Knex migrations do not match this release; run its migration container");
        if (reader.Read()) return Results.Fail<Unit>("invalid", "Management database Knex migrations do not match this release; run its migration container");
        return Results.Done();
    }

    private static long Scalar(DbConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }
}
