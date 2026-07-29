using System.Text;

namespace CtlFlow.Egress.Egressd.Service.Http;

internal static partial class PrivateBoundary
{
    internal static async Task WriteBoundaryError(
        HttpContext context,
        int statusCode,
        string body,
        CancellationToken cancellation)
    {
        if (context.Response.HasStarted)
        {
            context.Abort();
            return;
        }

        var allow = context.Response.Headers.Allow.ToString();
        var retryAfter = context.Response.Headers.RetryAfter.ToString();
        var proxyAuthenticate =
            context.Response.Headers.ProxyAuthenticate.ToString();
        var bytes = Encoding.ASCII.GetBytes($"{body}\n");
        context.Response.Headers.Clear();
        if (allow.Length > 0)
        {
            context.Response.Headers.Allow = allow;
        }
        if (retryAfter.Length > 0)
        {
            context.Response.Headers.RetryAfter = retryAfter;
        }
        if (proxyAuthenticate.Length > 0)
        {
            context.Response.Headers.ProxyAuthenticate =
                proxyAuthenticate;
        }
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "text/plain; charset=utf-8";
        context.Response.ContentLength = bytes.Length;
        await context.Response.Body.WriteAsync(bytes, cancellation);
    }
}
