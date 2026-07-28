using CtlFlow.Policy.Policyd.Db.Sqlite;

namespace CtlFlow.Policy.Policyd.Db.Providers;

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
