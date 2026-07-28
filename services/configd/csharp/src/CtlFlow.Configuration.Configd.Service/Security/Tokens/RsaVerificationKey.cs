namespace CtlFlow.Configuration.Configd.Service.Security.Tokens;

internal sealed record RsaVerificationKey(
    byte[] Modulus,
    byte[] Exponent);
