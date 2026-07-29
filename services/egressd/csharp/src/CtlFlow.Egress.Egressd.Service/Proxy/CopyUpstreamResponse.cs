using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static async Task CopyUpstreamResponse(
        HttpContext context,
        HttpResponseMessage source,
        EgressRule rule,
        CancellationToken cancellation)
    {
        if (source.Content.Headers.ContentLength
            > rule.MaximumResponseBodyBytes)
        {
            throw new ResponseBodyTooLargeException();
        }

        context.Response.StatusCode = (int)source.StatusCode;
        var connectionHeaders = ReadResponseConnectionHeaders(
            source.Headers);
        CopyResponseHeaders(
            context.Response.Headers,
            source.Headers,
            rule,
            connectionHeaders);
        CopyResponseHeaders(
            context.Response.Headers,
            source.Content.Headers,
            rule,
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
            rule.MaximumResponseBodyBytes,
            cancellation);
    }

    private static void CopyResponseHeaders(
        IHeaderDictionary target,
        System.Net.Http.Headers.HttpHeaders source,
        EgressRule rule,
        IReadOnlySet<string> connectionHeaders)
    {
        foreach (var (name, values) in source)
        {
            if (IsProtectedRuntimeHeader(name, connectionHeaders)
                || !IsAdmitted(rule.ForwardResponseHeaders, name))
            {
                continue;
            }
            target.Append(name, values.ToArray());
        }
    }

    private static IReadOnlySet<string> ReadResponseConnectionHeaders(
        System.Net.Http.Headers.HttpResponseHeaders headers) =>
        headers.TryGetValues("Connection", out var values)
            ? ReadConnectionHeaders(values)
            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
}
