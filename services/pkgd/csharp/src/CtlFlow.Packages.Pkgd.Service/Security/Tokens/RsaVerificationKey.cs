namespace CtlFlow.Packages.Pkgd.Service.Security.Tokens;

internal sealed record RsaVerificationKey(
    byte[] Modulus,
    byte[] Exponent);
