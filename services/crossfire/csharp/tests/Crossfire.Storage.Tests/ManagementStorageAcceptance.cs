using System.Data;
using Crossfire.AdapterSqlite;
using Crossfire.AdapterSqlite.Entities;
using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ManagementStorageAcceptance
{
    public static async Task Verify(CrossfireDbContext original, string ownerId)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Native private management storage requires Linux");
        var file = original.Database.GetDbConnection().DataSource;
        var displayName = original.Member.AsNoTracking().Where(row => row.PrincipalId == ownerId).Select(row => row.DisplayName).Single();
        using var storage = new ManagementStorage(file);
        var first = storage.Open();
        var connection = first.Database.GetDbConnection();
        Equal(connection.State, ConnectionState.Open, "a storage lease retains one connection across its queries");
        first.Member.Single(row => row.PrincipalId == ownerId).DisplayName = "Uncommitted tracked value";
        first.Database.BeginTransaction();
        first.Principal.Where(row => row.Id == ownerId).ExecuteUpdate(update => update.SetProperty(row => row.Revision, 123));
        first.Dispose();
        Equal(connection.State, ConnectionState.Closed, "returning a context releases its database connection");
        await using (var next = storage.Open())
        {
            Equal(ReferenceEquals(first, next), true, "the standard EF pool reuses the returned context");
            Equal(next.ChangeTracker.Entries().Count(), 0, "no tracked entity crosses a storage lease");
            Equal(next.Database.CurrentTransaction is null, true, "no transaction crosses a storage lease");
            Equal(next.Principal.AsNoTracking().Where(row => row.Id == ownerId).Select(row => row.Revision).Single(), 0L, "disposing a lease rolls back its unfinished transaction");
            Equal(next.Member.AsNoTracking().Where(row => row.PrincipalId == ownerId).Select(row => row.DisplayName).Single(), displayName, "uncommitted entity changes are discarded");
            using var concurrent = storage.Open();
            Equal(ReferenceEquals(concurrent, next), false, "concurrent callers never share a DbContext");
            concurrent.Member.Add(new MemberRow { PrincipalId = Identity.Identifier(), PrincipalKind = "human", DisplayName = "No matching principal" });
            var foreignKey = false;
            try { concurrent.SaveChanges(); }
            catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteExtendedErrorCode: 787 }) { foreignKey = true; }
            Equal(foreignKey, true, "pooled connections enforce actual foreign-key constraints");
        }
        Equal(connection.State, ConnectionState.Closed, "async disposal also releases the leased connection");
        var permissions = File.GetUnixFileMode(file);
        try
        {
            File.SetUnixFileMode(file, permissions | UnixFileMode.GroupRead);
            var refused = false;
            try { using var unsafeContext = storage.Open(); }
            catch (IOException) { refused = true; }
            Equal(refused, true, "every lease rechecks private file permissions before reusing a context");
        }
        finally { File.SetUnixFileMode(file, permissions); }
        using (var safe = storage.Open()) Equal(PolicyQueries.Find(safe).IsSuccess, true, "a rejected lease does not poison the context pool");
        storage.Dispose();
        var stopped = false;
        try { using var closed = storage.Open(); }
        catch (ObjectDisposedException) { stopped = true; }
        Equal(stopped, true, "a closed storage owner cannot issue another lease");
    }
}
