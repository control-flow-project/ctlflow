namespace CtlFlow.Identity.Identityd.Domain.Keys;

internal static partial class RsaPublicMaterial
{
    internal static byte[] DecodeBase64Url(string value, string label)
    {
        if (string.IsNullOrEmpty(value)
            || value.Any(character =>
                character is not (
                    >= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '-' or '_')))
        {
            throw new InvalidOperationException(
                $"Stored RSA {label} is not base64url");
        }

        try
        {
            return Convert.FromBase64String(
                value.Replace('-', '+').Replace('_', '/')
                + new string('=', (4 - value.Length % 4) % 4));
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException(
                $"Stored RSA {label} is not base64url",
                exception);
        }
    }
}
