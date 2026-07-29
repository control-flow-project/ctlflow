using System.Net;
using CtlFlow.Egress.Egressd.Domain.Rules;
using CtlFlow.Egress.Egressd.Service.Configuration;
using static CtlFlow.Egress.Egressd.Domain.Rules.Rules;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static async Task<HttpRequestMessage> CreateUpstreamRequest(
        HttpContext context,
        RequestTarget target,
        EgressRule rule,
        SecretValues secrets,
        Uri origin,
        CancellationToken cancellation)
    {
        var rewritten = await RewritePath(
            rule,
            target.Path,
            cancellation);
        var encodedPath = string.Join(
            "/",
            rewritten.Split('/').Select(Uri.EscapeDataString));
        if (!encodedPath.StartsWith("/", StringComparison.Ordinal))
        {
            encodedPath = $"/{encodedPath}";
        }
        var uri = new Uri(
            $"{origin.AbsoluteUri.TrimEnd('/')}{encodedPath}{target.Query}",
            new UriCreationOptions
            {
                DangerousDisablePathAndQueryCanonicalization = true
            });
        var outgoing = new HttpRequestMessage(
            new HttpMethod(context.Request.Method),
            uri)
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionOrLower
        };
        try
        {
            var hasBody = context.Request.ContentLength is > 0
                || context.Request.Headers.ContainsKey("Transfer-Encoding");
            if (hasBody)
            {
                if (context.Request.Method is "GET" or "HEAD")
                {
                    throw new InvalidRequestTargetException();
                }
                if (context.Request.ContentLength
                    > rule.MaximumRequestBodyBytes)
                {
                    throw new RequestBodyTooLargeException();
                }
                outgoing.Content = new BoundedRequestContent(
                    context.Request.Body,
                    context.Request.ContentLength,
                    rule.MaximumRequestBodyBytes);
            }

            CopyRequestHeaders(context.Request.Headers, outgoing, rule);
            ApplyHeaderReplacements(outgoing, rule, secrets);
            return outgoing;
        }
        catch
        {
            outgoing.Dispose();
            throw;
        }
    }

    private static void CopyRequestHeaders(
        IHeaderDictionary source,
        HttpRequestMessage target,
        EgressRule rule)
    {
        var connectionHeaders = ReadConnectionHeaders(source.Connection);
        foreach (var (name, values) in source)
        {
            if (IsProtectedRuntimeHeader(name, connectionHeaders)
                || !IsAdmitted(rule.ForwardRequestHeaders, name))
            {
                continue;
            }
            if (target.Headers.TryAddWithoutValidation(
                    name,
                    values.ToArray()))
            {
                continue;
            }
            EnsureContent(target).Headers.TryAddWithoutValidation(
                name,
                values.ToArray());
        }
    }

    private static void ApplyHeaderReplacements(
        HttpRequestMessage request,
        EgressRule rule,
        SecretValues secrets)
    {
        foreach (var replacement in rule.SetRequestHeaders)
        {
            var name = replacement.Name.Value;
            request.Headers.Remove(name);
            request.Content?.Headers.Remove(name);
            var value = replacement.Value switch
            {
                RequestHeaderValue.Literal literal => literal.Value,
                RequestHeaderValue.Secret secret =>
                    secrets.TryRead(secret.Name, out var material)
                        && material is not null
                        ? material.ReadForHeader()
                        : throw new InvalidOperationException(
                            "A configured Egress secret is unavailable"),
                _ => throw new InvalidOperationException(
                    "A configured header replacement is invalid")
            };
            if (!request.Headers.TryAddWithoutValidation(name, value))
            {
                EnsureContent(request).Headers.TryAddWithoutValidation(
                    name,
                    value);
            }
        }
    }

    private static HttpContent EnsureContent(HttpRequestMessage request)
    {
        request.Content ??= new ByteArrayContent([]);
        return request.Content;
    }
}
