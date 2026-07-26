namespace CtlFlow.Identity.Identityd.Domain.Keys;

using static RsaPublicMaterial;

public sealed record RsaModulus
{
    private RsaModulus(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static RsaModulus FromStorage(string value)
    {
        var bytes = DecodeBase64Url(value, "modulus");
        if (bytes.Length is < 128 or > 1024)
        {
            throw new InvalidOperationException(
                "Stored RSA modulus has invalid bounds");
        }

        return new RsaModulus(value);
    }
}
