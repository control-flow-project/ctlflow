using Crossfire.AdapterSqlite;
using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class StorageConcurrencyAcceptance
{
    public static void Verify(CrossfireDbContext context, string ownerId)
    {
        var file = context.Database.GetDbConnection().DataSource;
        using var reader = new CrossfireDbContext(DatabaseConnections.Options(file, readOnly: true));
        reader.Database.OpenConnection();
        Equal(Metadata.Journal(reader), "wal", "management implementations share write-ahead logging");
        using var transaction = ((SqliteConnection)reader.Database.GetDbConnection()).BeginTransaction(deferred: true);
        reader.Database.UseTransaction(transaction);
        Equal(Revision(), 0L, "a management read snapshot sees the original revision");
        using var writer = new CrossfireDbContext(DatabaseConnections.Options(file));
        Equal(Transactions.Run(writer, () =>
        {
            writer.Principal.Where(row => row.Id == ownerId).ExecuteUpdate(update => update.SetProperty(row => row.Revision, 1));
            return Results.Done();
        }).IsSuccess, true, "a controller write commits while a management read snapshot remains open");
        Equal(Revision(), 0L, "a concurrent commit does not replace a reader's snapshot");
        transaction.Rollback();
        reader.Database.UseTransaction(null);
        Equal(Revision(), 1L, "a new read observes the committed revision");
        Equal(Transactions.Run(writer, () =>
        {
            writer.Principal.Where(row => row.Id == ownerId).ExecuteUpdate(update => update.SetProperty(row => row.Revision, 0));
            return Results.Done();
        }).IsSuccess, true, "the isolated concurrency fixture restores its original revision");

        long Revision() => reader.Principal.Where(row => row.Id == ownerId).Select(row => row.Revision).Single();
    }
}
