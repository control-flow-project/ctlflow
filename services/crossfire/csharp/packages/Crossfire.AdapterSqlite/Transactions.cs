using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class Transactions
{
    public static Result<T> Run<T>(CrossfireDbContext context, Func<Result<T>> operation)
    {
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction = null;
        var outer = context.Database.CurrentTransaction;
        string? savepoint = null;
        var savepointCreated = false;
        try
        {
            if (outer is null) transaction = context.Database.BeginTransaction();
            else
            {
                context.SaveChanges();
                transaction = outer;
                savepoint = "domain_" + Guid.NewGuid().ToString("N");
                transaction.CreateSavepoint(savepoint);
                savepointCreated = true;
            }
            var result = operation();
            if (!result.IsSuccess)
            {
                Rollback();
                context.ChangeTracker.Clear();
                return result;
            }
            context.SaveChanges();
            if (savepoint is null) transaction.Commit();
            else transaction.ReleaseSavepoint(savepoint);
            return result;
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqliteException sqlite && Stored.Failure(sqlite) is not null)
        {
            Rollback();
            context.ChangeTracker.Clear();
            return Result<T>.Fail(Stored.Failure(sqlite)!);
        }
        catch (SqliteException sqlite) when (Stored.Failure(sqlite) is not null)
        {
            Rollback();
            context.ChangeTracker.Clear();
            return Result<T>.Fail(Stored.Failure(sqlite)!);
        }
        catch
        {
            Rollback();
            context.ChangeTracker.Clear();
            throw;
        }
        finally { if (outer is null) transaction?.Dispose(); }

        void Rollback()
        {
            if (transaction is null) return;
            if (savepoint is null) transaction.Rollback();
            else if (savepointCreated) { transaction.RollbackToSavepoint(savepoint); transaction.ReleaseSavepoint(savepoint); }
        }
    }
}
