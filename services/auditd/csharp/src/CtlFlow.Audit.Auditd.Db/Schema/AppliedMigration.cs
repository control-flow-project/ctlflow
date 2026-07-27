namespace CtlFlow.Audit.Auditd.Db;

public class AppliedMigration
{
    private AppliedMigration()
    {
    }

    internal int Id { get; private set; }

    internal string? Name { get; private set; }
}
