using System.Text;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class FormEncoding
{
    internal static Dictionary<string, string> ParseFormFields(
        ReadOnlySpan<byte> encoded,
        int maximumFields)
    {
        var fields = new Dictionary<string, string>(
            StringComparer.Ordinal);
        if (encoded.Length == 0)
        {
            return fields;
        }

        var offset = 0;
        while (offset <= encoded.Length)
        {
            var remaining = encoded[offset..];
            var separator = remaining.IndexOf((byte)'&');
            var segment = separator < 0
                ? remaining
                : remaining[..separator];
            if (segment.Length == 0)
            {
                throw new HttpContractException(
                    StatusCodes.Status400BadRequest,
                    "invalid_fields");
            }

            var equals = segment.IndexOf((byte)'=');
            var nameBytes = equals < 0 ? segment : segment[..equals];
            var valueBytes = equals < 0 ? [] : segment[(equals + 1)..];
            var name = DecodeFormComponent(nameBytes);
            var value = DecodeFormComponent(valueBytes);
            if (name.Length == 0
                || fields.Count >= maximumFields
                || !fields.TryAdd(name, value))
            {
                throw new HttpContractException(
                    StatusCodes.Status400BadRequest,
                    "invalid_fields");
            }

            if (separator < 0)
            {
                break;
            }
            offset += separator + 1;
        }

        return fields;
    }

    internal static byte[] EncodeQueryBytes(string value) =>
        Encoding.ASCII.GetBytes(value);
}
