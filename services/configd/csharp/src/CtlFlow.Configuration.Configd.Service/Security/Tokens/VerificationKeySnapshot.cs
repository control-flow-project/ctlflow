namespace CtlFlow.Configuration.Configd.Service.Security.Tokens;

internal sealed record VerificationKeySnapshot(
    IReadOnlyDictionary<string, RsaVerificationKey> Keys,
    DateTimeOffset ExpiresAt);
