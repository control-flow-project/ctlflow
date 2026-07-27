using System.Text;

namespace CtlFlow.Auth.Authd.Service.Http;

internal sealed record CallbackQuery(
    string State,
    string? Code,
    string? Error)
{
    public override string ToString() => "[REDACTED]";
}

internal static partial class CallbackQueries
{
    internal static CallbackQuery ParseCallbackQuery(HttpRequest request)
    {
        if (request.ContentLength is > 0
            || request.Headers.TransferEncoding.Count > 0)
        {
            throw new HttpContractException(
                StatusCodes.Status413PayloadTooLarge,
                "callback_body");
        }

        var target = request.PathBase.Value
            + request.Path.Value
            + request.QueryString.Value;
        if (Encoding.UTF8.GetByteCount(target) > 16 * 1024)
        {
            throw new HttpContractException(
                StatusCodes.Status414UriTooLong,
                "target_too_large");
        }

        var raw = request.QueryString.Value;
        if (string.IsNullOrEmpty(raw) || raw[0] != '?')
        {
            throw InvalidQuery();
        }
        if (raw.Any(character => character > 0x7f))
        {
            throw InvalidQuery();
        }

        var fields = FormEncoding.ParseFormFields(
            Encoding.ASCII.GetBytes(raw[1..]),
            maximumFields: 3);
        if (!fields.Remove("state", out var state)
            || !BrowserValues.IsCanonical32ByteValue(state))
        {
            throw InvalidQuery();
        }

        if (fields.Count == 1
            && fields.Remove("code", out var code)
            && IsAuthorizationCode(code))
        {
            return new CallbackQuery(state, code, null);
        }
        if (fields.Remove("error", out var error)
            && IsNqschar(error, 64)
            && (fields.Count == 0
                || fields.Count == 1
                && fields.Remove(
                    "error_description",
                    out var description)
                && IsNqschar(description, 256)))
        {
            return new CallbackQuery(state, null, error);
        }

        throw InvalidQuery();
    }

    private static bool IsAuthorizationCode(string value) =>
        value.Length is >= 1 and <= 2_048
        && value.All(character => character is >= ' ' and <= '~');

    private static bool IsNqschar(string value, int maximum) =>
        value.Length >= 1
        && value.Length <= maximum
        && value.All(character =>
            character is >= ' ' and <= '!'
                or >= '#' and <= '['
                or >= ']' and <= '~');

    private static HttpContractException InvalidQuery() =>
        new(StatusCodes.Status400BadRequest, "invalid_callback");
}
