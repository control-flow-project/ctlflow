namespace CtlFlow.Identity.Identityd.Domain.Keys;

public static partial class VerificationKeys
{
    public static ValueTask<VerificationKeySet> CreateVerificationKeySet(
        IReadOnlyList<VerificationKeyDetails> candidates,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (candidates.Count is < 1 or > 8)
        {
            throw new InvalidOperationException(
                "Current verification key count is outside its bound");
        }

        var activeCount = 0;
        for (var index = 0; index < candidates.Count; index++)
        {
            var candidate = candidates[index];
            if (candidate.State == VerificationKeyState.Active)
            {
                activeCount++;
            }

            if (candidate.Algorithm != VerificationKeyAlgorithm.Rs256
                || candidate.State is not (
                    VerificationKeyState.Active
                    or VerificationKeyState.Retiring)
                || (
                    index > 0
                    && string.CompareOrdinal(
                        candidates[index - 1].KeyId.Value,
                        candidate.KeyId.Value) >= 0))
            {
                throw new InvalidOperationException(
                    "Current verification key set is malformed");
            }
        }

        if (activeCount != 1)
        {
            throw new InvalidOperationException(
                "Current verification key set must contain one active key");
        }

        return ValueTask.FromResult(new VerificationKeySet(candidates));
    }
}
