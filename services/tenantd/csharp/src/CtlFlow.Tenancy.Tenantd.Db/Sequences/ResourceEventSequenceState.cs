namespace CtlFlow.Tenancy.Tenantd.Db.Sequences;

public class ResourceEventSequenceState
{
    private ResourceEventSequenceState()
    {
    }

    internal ResourceEventSequenceState(
        int sequenceId,
        long currentSequence,
        long retainedFromSequence)
    {
        SequenceId = sequenceId;
        CurrentSequence = currentSequence;
        RetainedFromSequence = retainedFromSequence;
    }

    public int SequenceId { get; private set; }

    public long CurrentSequence { get; internal set; }

    public long RetainedFromSequence { get; internal set; }
}
