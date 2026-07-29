namespace CtlFlow.Execution.Execd.Service.Security.Tokens;

internal sealed record RsaVerificationKey(
    byte[] Modulus,
    byte[] Exponent);
