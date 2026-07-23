namespace CtlFlow.Tenancy.Tenantd.Db;

public class AppliedMigration
{
    private AppliedMigration()
    {
    }

    internal int Id { get; private set; }

    internal string Name { get; private set; } = string.Empty;
}
