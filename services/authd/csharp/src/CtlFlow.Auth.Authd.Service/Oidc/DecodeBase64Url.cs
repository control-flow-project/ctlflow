namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcEncoding
{
    internal static byte[] DecodeBase64Url(
        string value,
        int maximumBytes)
    {
        if (value.Length == 0
            || value.Any(character =>
                character is not (>= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '_'
                    or '-')))
        {
            throw new OidcRejectedException();
        }

        try
        {
            var decoded = Convert.FromBase64String(
                value
                    .Replace('-', '+')
                    .Replace('_', '/')
                    .PadRight((value.Length + 3) / 4 * 4, '='));
            if (decoded.Length > maximumBytes
                || BrowserValues.Encode(decoded) != value)
            {
                throw new OidcRejectedException();
            }
            return decoded;
        }
        catch (FormatException)
        {
            throw new OidcRejectedException();
        }
    }
}
