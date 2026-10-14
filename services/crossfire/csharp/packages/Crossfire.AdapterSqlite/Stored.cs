using Crossfire.Kernel;
using Microsoft.Data.Sqlite;

namespace Crossfire.AdapterSqlite;

public static class Stored
{
    public static Failure? Failure(SqliteException exception) => exception.SqliteErrorCode switch
    {
        19 => new("conflict", "The operation conflicts with the current stored state"),
        5 => new("unavailable", "Storage is busy; retry this operation"),
        13 => new("unavailable", "Management storage is full; check available disk space before retrying"),
        _ => null
    };

    public static Result<T> Read<T>(Func<T> operation)
    {
        try { return Result<T>.Success(operation()); }
        catch (SqliteException exception) when (Failure(exception) is not null)
        { return Result<T>.Fail(Failure(exception)!); }
    }
}

public sealed record SqliteUnitOfWork(CrossfireDbContext Context) : Crossfire.Domain.UnitOfWork
{
    public Result<T> Run<T>(Func<Result<T>> operation) => Transactions.Run(Context, operation);
}
