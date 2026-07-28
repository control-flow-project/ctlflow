namespace CtlFlow.Configuration.Configd.Db;

public class AppliedMigration
{
    private AppliedMigration()
    {
    }

    internal int Id { get; private set; }

    internal string? Name { get; private set; }
}
