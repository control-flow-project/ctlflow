namespace CtlFlow.Tenancy.Tenantd.Db.Sequences;

public class LifecycleDeliverySequenceState
{
    private LifecycleDeliverySequenceState()
    {
    }

    internal LifecycleDeliverySequenceState(
        int sequenceId,
        long currentSequence)
    {
        SequenceId = sequenceId;
        CurrentSequence = currentSequence;
    }

    public int SequenceId { get; private set; }

    public long CurrentSequence { get; internal set; }
}
