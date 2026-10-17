using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class Schema
{
    public static Result<Unit> Validate(CrossfireDbContext context)
    {
        context.Database.OpenConnection();
        var connection = context.Database.GetDbConnection();
        if (Metadata.Application(context) != SchemaContract.ApplicationId
            || Metadata.Version(context) != SchemaContract.Version)
            return Results.Fail<Unit>("invalid", "Unsupported Crossfire schema; run the Knex migration container before starting the server. No data was changed");
        if (!Metadata.HasMigrations(context))
            return Results.Fail<Unit>("invalid", "Management database has not been migrated by Knex; run the migration container");
        if (!Metadata.Migrations(context).SequenceEqual(SchemaContract.Migrations))
            return Results.Fail<Unit>("invalid", "Management database Knex migrations do not match this release; run its migration container");
        if (new SqliteConnectionStringBuilder(connection.ConnectionString).Mode != SqliteOpenMode.Memory)
        {
            using var journal = connection.CreateCommand(); journal.CommandText = "PRAGMA journal_mode=WAL";
            if (journal.ExecuteScalar() is not string mode || mode != "wal")
                return Results.Fail<Unit>("unavailable", "Management storage requires write-ahead logging for concurrent readers and heartbeats");
        }
        using var durability = connection.CreateCommand(); durability.CommandText = "PRAGMA synchronous=FULL"; durability.ExecuteNonQuery();
        return Results.Done();
    }
}
