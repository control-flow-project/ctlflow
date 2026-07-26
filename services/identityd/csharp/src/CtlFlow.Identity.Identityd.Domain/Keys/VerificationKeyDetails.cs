using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Keys;

public sealed record VerificationKeyDetails(
    VerificationKeyId KeyId,
    VerificationKeyAlgorithm Algorithm,
    RsaModulus Modulus,
    RsaExponent Exponent,
    VerificationKeyState State,
    Revision Revision);
