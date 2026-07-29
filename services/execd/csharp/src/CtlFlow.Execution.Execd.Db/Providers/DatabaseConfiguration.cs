using CtlFlow.Execution.Execd.Db.Sqlite;

namespace CtlFlow.Execution.Execd.Db.Providers;

public abstract record DatabaseConfiguration
{
    private DatabaseConfiguration()
    {
    }

    public abstract DatabaseProvider Provider { get; }

    public sealed record Sqlite(
        DatabaseFilePath Path,
        DatabasePoolSize PoolSize) : DatabaseConfiguration
    {
        public override DatabaseProvider Provider => DatabaseProvider.Sqlite;
    }
}
