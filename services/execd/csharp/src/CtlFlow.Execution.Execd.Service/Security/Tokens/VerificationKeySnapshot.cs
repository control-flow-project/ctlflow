namespace CtlFlow.Execution.Execd.Service.Security.Tokens;

internal sealed record VerificationKeySnapshot(
    IReadOnlyDictionary<string, RsaVerificationKey> Keys,
    DateTimeOffset ExpiresAt);
