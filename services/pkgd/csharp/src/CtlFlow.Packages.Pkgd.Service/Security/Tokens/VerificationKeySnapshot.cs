namespace CtlFlow.Packages.Pkgd.Service.Security.Tokens;

internal sealed record VerificationKeySnapshot(
    IReadOnlyDictionary<string, RsaVerificationKey> Keys,
    DateTimeOffset ExpiresAt);
