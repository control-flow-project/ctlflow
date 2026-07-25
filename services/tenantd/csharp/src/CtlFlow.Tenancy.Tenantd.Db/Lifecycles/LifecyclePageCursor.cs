namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public class LifecyclePageCursor
{
    private LifecyclePageCursor()
    {
    }

    internal LifecyclePageCursor(
        string pageToken,
        int stepKey,
        string requestActor,
        long lastDeliverySequence,
        long snapshotSequence,
        long expiresAtUnixMilliseconds)
    {
        PageToken = pageToken;
        StepKey = stepKey;
        RequestActor = requestActor;
        LastDeliverySequence = lastDeliverySequence;
        SnapshotSequence = snapshotSequence;
        ExpiresAtUnixMilliseconds = expiresAtUnixMilliseconds;
    }

    public string PageToken { get; private set; } = string.Empty;

    public int StepKey { get; private set; }

    public string RequestActor { get; private set; } = string.Empty;

    public long LastDeliverySequence { get; private set; }

    public long SnapshotSequence { get; private set; }

    public long ExpiresAtUnixMilliseconds { get; private set; }
}
