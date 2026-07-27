namespace CtlFlow.Audit.Auditd.Service.Security.Tokens;

internal static partial class JsonWebKeys
{
    internal static RsaVerificationKey CreateRsaVerificationKey(
        string modulus,
        string exponent)
    {
        var modulusBytes = DecodeBase64Url(modulus);
        var exponentBytes = DecodeBase64Url(exponent);
        if (modulusBytes.Length is < 128 or > 1024
            || exponentBytes.Length is < 1 or > 8)
        {
            throw new InvalidDataException(
                "The verification key has invalid material bounds");
        }

        return new RsaVerificationKey(modulusBytes, exponentBytes);
    }

    private static byte[] DecodeBase64Url(string value)
    {
        try
        {
            return Convert.FromBase64String(
                value.Replace('-', '+').Replace('_', '/')
                + new string('=', (4 - value.Length % 4) % 4));
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException(
                "The verification key contains invalid material",
                exception);
        }
    }
}
