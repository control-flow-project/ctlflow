namespace CtlFlow.Identity.Identityd.Domain.Keys;

public sealed record VerificationKeySet(
    IReadOnlyList<VerificationKeyDetails> Keys);
