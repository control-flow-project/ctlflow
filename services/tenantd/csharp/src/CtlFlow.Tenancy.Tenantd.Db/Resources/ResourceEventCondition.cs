namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

public class ResourceEventCondition
{
    private ResourceEventCondition()
    {
    }

    internal ResourceEventCondition(
        long eventSequence,
        int stepKey,
        int stepState,
        long? ownerRevision,
        string? blockedReason,
        long updatedAtUnixMilliseconds)
    {
        EventSequence = eventSequence;
        StepKey = stepKey;
        StepState = stepState;
        OwnerRevision = ownerRevision;
        BlockedReason = blockedReason;
        UpdatedAtUnixMilliseconds = updatedAtUnixMilliseconds;
    }

    public long EventSequence { get; private set; }

    public int StepKey { get; private set; }

    public int StepState { get; private set; }

    public long? OwnerRevision { get; private set; }

    public string? BlockedReason { get; private set; }

    public long UpdatedAtUnixMilliseconds { get; private set; }
}
