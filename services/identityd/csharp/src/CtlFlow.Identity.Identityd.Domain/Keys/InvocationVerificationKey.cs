using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Keys;

public class InvocationVerificationKey
{
    private string _exponent = null!;
    private string _id = null!;
    private string _modulus = null!;

    private InvocationVerificationKey()
    {
    }

    public VerificationKeyId Id => VerificationKeyId.FromStorage(_id);

    public RsaModulus Modulus => RsaModulus.FromStorage(_modulus);

    public RsaExponent Exponent => RsaExponent.FromStorage(_exponent);

    public VerificationKeyAlgorithm Algorithm { get; private set; }

    public VerificationKeyState State { get; private set; }

    public Revision Revision { get; private set; } = null!;
}
