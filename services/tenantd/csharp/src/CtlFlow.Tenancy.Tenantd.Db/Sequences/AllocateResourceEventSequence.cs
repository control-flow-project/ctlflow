using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Sequences;

internal static partial class Sequences
{
    internal static ResourceEventSequence AllocateResourceEventSequence(
        ResourceEventSequenceState state)
    {
        state.CurrentSequence = checked(state.CurrentSequence + 1);
        return ResourceEventSequence.FromStorage(state.CurrentSequence);
    }
}
