namespace CtlFlow.Execution.Execd.Db;

public class AppliedMigration
{
    private AppliedMigration()
    {
    }

    internal int Id { get; private set; }

    internal string? Name { get; private set; }
}
