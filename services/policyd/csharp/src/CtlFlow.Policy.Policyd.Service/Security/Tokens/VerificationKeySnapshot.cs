namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

internal sealed record VerificationKeySnapshot(
    IReadOnlyDictionary<string, RsaVerificationKey> Keys,
    DateTimeOffset ExpiresAt);
