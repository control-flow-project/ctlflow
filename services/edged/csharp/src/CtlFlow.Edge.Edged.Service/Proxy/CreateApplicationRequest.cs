using System.Net;
using System.Net.Http.Headers;
using CtlFlow.Edge.Edged.Service.Identity;
using Microsoft.AspNetCore.Http.Features;

namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    internal static HttpRequestMessage CreateApplicationRequest(
        HttpContext context,
        Uri origin,
        InvocationCredential invocation,
        string? applicationCookie,
        long maximumBodyBytes)
    {
        var rawTarget =
            context.Features.Get<IHttpRequestFeature>()?.RawTarget
            ?? $"{context.Request.PathBase}{context.Request.Path}"
                + context.Request.QueryString;
        if (!rawTarget.StartsWith("/", StringComparison.Ordinal)
            || rawTarget.Contains('#', StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Public request target is invalid");
        }

        var target = new Uri(
            $"{origin.AbsoluteUri.TrimEnd('/')}{rawTarget}",
            new UriCreationOptions
            {
                DangerousDisablePathAndQueryCanonicalization = true
            });
        var outgoing = new HttpRequestMessage(
            new HttpMethod(context.Request.Method),
            target)
        {
            Version = HttpVersion.Version11,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact
        };
        if (context.Request.ContentLength is > 0
            || context.Request.Headers.ContainsKey(
                "Transfer-Encoding"))
        {
            if (context.Request.ContentLength > maximumBodyBytes)
            {
                outgoing.Dispose();
                throw new RequestBodyTooLargeException();
            }
            outgoing.Content = new BoundedRequestContent(
                context.Request.Body,
                context.Request.ContentLength,
                maximumBodyBytes);
        }

        CopyRequestHeaders(
            context.Request.Headers,
            outgoing);
        if (applicationCookie is not null)
        {
            outgoing.Headers.TryAddWithoutValidation(
                "Cookie",
                applicationCookie);
        }
        outgoing.Headers.Authorization =
            new AuthenticationHeaderValue(
                "Bearer",
                invocation.ReadForApplicationAuthorization());
        return outgoing;
    }

    private static void CopyRequestHeaders(
        IHeaderDictionary source,
        HttpRequestMessage target)
    {
        var connectionHeaders = ReadConnectionHeaders(source);
        foreach (var (name, values) in source)
        {
            if (IsProtectedRequestHeader(name, connectionHeaders))
            {
                continue;
            }

            if (target.Headers.TryAddWithoutValidation(
                    name,
                    values.ToArray()))
            {
                continue;
            }

            target.Content?.Headers.TryAddWithoutValidation(
                name,
                values.ToArray());
        }
    }
}
