namespace CtlFlow.Identity.Identityd.Service.Security.Tokens;

internal sealed record VerificationKeySnapshot(
    IReadOnlyDictionary<string, RsaVerificationKey> Keys,
    DateTimeOffset ExpiresAt);
