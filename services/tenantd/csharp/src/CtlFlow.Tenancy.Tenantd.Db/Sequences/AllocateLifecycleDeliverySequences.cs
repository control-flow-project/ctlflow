using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Sequences;

internal static partial class Sequences
{
    internal static IReadOnlyList<LifecycleDeliverySequence>
        AllocateLifecycleDeliverySequences(
            LifecycleDeliverySequenceState state,
            int count)
    {
        if (count <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(count));
        }

        var first = checked(state.CurrentSequence + 1);
        state.CurrentSequence = checked(state.CurrentSequence + count);

        return Enumerable
            .Range(0, count)
            .Select(offset => LifecycleDeliverySequence.FromStorage(
                checked(first + offset)))
            .ToArray();
    }
}
