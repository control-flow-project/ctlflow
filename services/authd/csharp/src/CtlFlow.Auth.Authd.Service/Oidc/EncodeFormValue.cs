using System.Text;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcEncoding
{
    internal static string EncodeFormValue(string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var result = new StringBuilder(bytes.Length);
        foreach (var item in bytes)
        {
            if (item is >= (byte)'A' and <= (byte)'Z'
                or >= (byte)'a' and <= (byte)'z'
                or >= (byte)'0' and <= (byte)'9'
                or (byte)'-'
                or (byte)'.'
                or (byte)'_'
                or (byte)'~')
            {
                result.Append((char)item);
            }
            else if (item == ' ')
            {
                result.Append('+');
            }
            else
            {
                result.Append('%');
                result.Append(item.ToString("X2"));
            }
        }
        return result.ToString();
    }
}
