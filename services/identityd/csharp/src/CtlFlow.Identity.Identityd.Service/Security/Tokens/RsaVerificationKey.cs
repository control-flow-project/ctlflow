namespace CtlFlow.Identity.Identityd.Service.Security.Tokens;

internal sealed record RsaVerificationKey(
    byte[] Modulus,
    byte[] Exponent);
