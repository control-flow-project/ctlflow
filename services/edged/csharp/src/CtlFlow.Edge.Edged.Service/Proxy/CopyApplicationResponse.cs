namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    internal static async Task CopyApplicationResponse(
        HttpContext context,
        HttpResponseMessage source,
        long maximumBodyBytes,
        CancellationToken cancellation)
    {
        if (source.Content.Headers.ContentLength > maximumBodyBytes)
        {
            throw new ResponseBodyTooLargeException();
        }

        context.Response.StatusCode = (int)source.StatusCode;
        var connectionHeaders = ReadConnectionHeaders(
            source.Headers);
        CopyHeaders(
            context.Response.Headers,
            source.Headers,
            connectionHeaders);
        CopyHeaders(
            context.Response.Headers,
            source.Content.Headers,
            connectionHeaders);
        context.Response.Headers.Remove("transfer-encoding");
        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        await using var body = await source.Content.ReadAsStreamAsync(
            cancellation);
        await CopyResponseBody(
            body,
            context,
            maximumBodyBytes,
            cancellation);
    }

    private static void CopyHeaders(
        IHeaderDictionary target,
        System.Net.Http.Headers.HttpHeaders source,
        IReadOnlySet<string> connectionHeaders)
    {
        foreach (var (name, values) in source)
        {
            if (IsProtectedResponseHeader(name, connectionHeaders))
            {
                continue;
            }

            if (name.Equals(
                    "Set-Cookie",
                    StringComparison.OrdinalIgnoreCase))
            {
                foreach (var value in values)
                {
                    if (!IsPlatformSessionCookie(value))
                    {
                        target.Append(name, value);
                    }
                }
                continue;
            }

            target.Append(name, values.ToArray());
        }
    }

    private static IReadOnlySet<string> ReadConnectionHeaders(
        System.Net.Http.Headers.HttpResponseHeaders headers)
    {
        var result = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);
        if (!headers.TryGetValues("Connection", out var values))
        {
            return result;
        }

        foreach (var header in values)
        {
            foreach (var item in header.Split(','))
            {
                var value = item.Trim();
                if (value.Length > 0)
                {
                    result.Add(value);
                }
            }
        }

        return result;
    }
}
