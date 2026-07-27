namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class FormEncoding
{
    private const int MaximumFormBytes = 4 * 1024;

    internal static async Task<Dictionary<string, string>> ReadForm(
        HttpRequest request,
        int maximumFields,
        bool optional,
        CancellationToken cancellation)
    {
        var hasTransferEncoding =
            request.Headers.TransferEncoding.Count > 0;
        var hasBody = request.ContentLength is > 0
            || hasTransferEncoding;
        if (optional && !hasBody && request.ContentType is null)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
        if (!IsFormContentType(request.ContentType))
        {
            throw new HttpContractException(
                StatusCodes.Status415UnsupportedMediaType,
                "unsupported_media_type");
        }
        if (request.ContentLength > MaximumFormBytes)
        {
            throw new HttpContractException(
                StatusCodes.Status413PayloadTooLarge,
                "body_too_large");
        }

        var body = new byte[MaximumFormBytes + 1];
        var read = 0;
        while (read < body.Length)
        {
            var count = await request.Body.ReadAsync(
                body.AsMemory(read),
                cancellation);
            if (count == 0)
            {
                break;
            }
            read += count;
        }
        if (read > MaximumFormBytes)
        {
            throw new HttpContractException(
                StatusCodes.Status413PayloadTooLarge,
                "body_too_large");
        }

        return ParseFormFields(body.AsSpan(0, read), maximumFields);
    }

    private static bool IsFormContentType(string? contentType)
    {
        if (contentType is null)
        {
            return false;
        }

        var segments = contentType.Split(';');
        if (segments.Length is < 1 or > 2
            || !string.Equals(
                segments[0].Trim(),
                "application/x-www-form-urlencoded",
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        if (segments.Length == 1)
        {
            return true;
        }

        var parameter = segments[1].Trim();
        var separator = parameter.IndexOf('=');
        if (separator <= 0)
        {
            return false;
        }
        var name = parameter[..separator].Trim();
        var value = parameter[(separator + 1)..].Trim();
        if (value.Length >= 2
            && value[0] == '"'
            && value[^1] == '"')
        {
            value = value[1..^1];
        }
        else if (value.Contains('"'))
        {
            return false;
        }
        return string.Equals(
                name,
                "charset",
                StringComparison.OrdinalIgnoreCase)
            && string.Equals(
                value,
                "utf-8",
                StringComparison.OrdinalIgnoreCase);
    }
}
