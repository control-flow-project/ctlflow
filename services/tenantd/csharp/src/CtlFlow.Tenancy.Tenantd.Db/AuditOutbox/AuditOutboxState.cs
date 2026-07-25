namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public class AuditOutboxState
{
    private AuditOutboxState()
    {
    }

    internal AuditOutboxState(
        int stateId,
        int maximumPending,
        int pendingCount,
        int permanentlyBlocked,
        long revision)
    {
        StateId = stateId;
        MaximumPending = maximumPending;
        PendingCount = pendingCount;
        PermanentlyBlocked = permanentlyBlocked;
        Revision = revision;
    }

    public int StateId { get; private set; }
    public int MaximumPending { get; private set; }
    public int PendingCount { get; private set; }
    public int PermanentlyBlocked { get; private set; }
    public long Revision { get; private set; }
}
