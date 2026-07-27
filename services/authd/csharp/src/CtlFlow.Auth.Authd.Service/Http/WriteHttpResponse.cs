using Microsoft.Net.Http.Headers;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class HttpResponses
{
    private const string ErrorBody = "Request could not be completed.";

    internal static void AddSecurityHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Content-Security-Policy"] =
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    }

    internal static async Task WriteError(
        HttpResponse response,
        int statusCode,
        CancellationToken cancellation,
        bool clearStateCookie = false,
        int? retryAfterSeconds = null)
    {
        response.StatusCode = statusCode;
        response.ContentType = "text/plain; charset=utf-8";
        if (clearStateCookie)
        {
            response.Headers.Append(
                HeaderNames.SetCookie,
                BrowserCookies.ClearStateCookie);
        }
        if (retryAfterSeconds is not null)
        {
            response.Headers.RetryAfter =
                retryAfterSeconds.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture);
        }

        await response.WriteAsync(ErrorBody, cancellation);
    }

    internal static void WriteRedirect(
        HttpResponse response,
        string location)
    {
        response.StatusCode = StatusCodes.Status303SeeOther;
        response.Headers.Location = location;
        response.ContentLength = 0;
    }
}
