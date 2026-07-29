namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal sealed record RsaVerificationKey(
    byte[] Modulus,
    byte[] Exponent);
