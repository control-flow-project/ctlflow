namespace CtlFlow.Identity.Identityd.Domain.Keys;

using static RsaPublicMaterial;

public sealed record RsaExponent
{
    private RsaExponent(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static RsaExponent FromStorage(string value)
    {
        var bytes = DecodeBase64Url(value, "exponent");
        if (bytes.Length is < 1 or > 8)
        {
            throw new InvalidOperationException(
                "Stored RSA exponent has invalid bounds");
        }

        return new RsaExponent(value);
    }
}
