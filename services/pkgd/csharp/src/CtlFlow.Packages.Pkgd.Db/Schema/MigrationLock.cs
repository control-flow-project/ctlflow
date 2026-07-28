namespace CtlFlow.Packages.Pkgd.Db;

public class MigrationLock
{
    public long Index { get; private set; }

    public long? IsLocked { get; private set; }
}
