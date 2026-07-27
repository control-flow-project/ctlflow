namespace CtlFlow.Audit.Auditd.Db;

public class MigrationLock
{
    public long Index { get; private set; }

    public long? IsLocked { get; private set; }
}
