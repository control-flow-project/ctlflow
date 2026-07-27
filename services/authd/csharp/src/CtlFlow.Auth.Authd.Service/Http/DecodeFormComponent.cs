using System.Text;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class FormEncoding
{
    private static readonly UTF8Encoding StrictUtf8 =
        new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    internal static string DecodeFormComponent(
        ReadOnlySpan<byte> encoded)
    {
        var decoded = new byte[encoded.Length];
        var written = 0;
        for (var index = 0; index < encoded.Length; index++)
        {
            var value = encoded[index];
            if (value == '+')
            {
                decoded[written++] = (byte)' ';
                continue;
            }
            if (value != '%')
            {
                decoded[written++] = value;
                continue;
            }
            if (index + 2 >= encoded.Length
                || !TryReadHex(encoded[index + 1], out var high)
                || !TryReadHex(encoded[index + 2], out var low))
            {
                throw new HttpContractException(
                    StatusCodes.Status400BadRequest,
                    "invalid_encoding");
            }

            decoded[written++] = (byte)((high << 4) | low);
            index += 2;
        }

        try
        {
            var result = StrictUtf8.GetString(decoded, 0, written);
            if (result.Contains('\0'))
            {
                throw new HttpContractException(
                    StatusCodes.Status400BadRequest,
                    "invalid_encoding");
            }
            return result;
        }
        catch (DecoderFallbackException)
        {
            throw new HttpContractException(
                StatusCodes.Status400BadRequest,
                "invalid_encoding");
        }
    }

    private static bool TryReadHex(byte value, out int result)
    {
        if (value is >= (byte)'0' and <= (byte)'9')
        {
            result = value - '0';
            return true;
        }
        if (value is >= (byte)'A' and <= (byte)'F')
        {
            result = value - 'A' + 10;
            return true;
        }
        if (value is >= (byte)'a' and <= (byte)'f')
        {
            result = value - 'a' + 10;
            return true;
        }

        result = 0;
        return false;
    }
}
