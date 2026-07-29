using System.Text;
using Microsoft.AspNetCore.Http.Features;

namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    internal static int CalculateHeaderBytes(IHeaderDictionary headers)
    {
        var bytes = 0;
        foreach (var (name, values) in headers)
        {
            foreach (var value in values)
            {
                bytes = checked(
                    bytes
                    + Encoding.UTF8.GetByteCount(name)
                    + Encoding.UTF8.GetByteCount(value ?? "")
                    + 4);
            }
        }

        return bytes;
    }

    internal static int CalculateCookieBytes(IHeaderDictionary headers)
    {
        var bytes = 0;
        foreach (var value in headers.Cookie)
        {
            bytes = checked(
                bytes + Encoding.UTF8.GetByteCount(value ?? ""));
        }

        return bytes;
    }

    internal static int CalculateTargetBytes(HttpRequest request)
    {
        var rawTarget =
            request.HttpContext.Features
                .Get<IHttpRequestFeature>()?
                .RawTarget
            ?? $"{request.PathBase}{request.Path}{request.QueryString}";
        return Encoding.UTF8.GetByteCount(rawTarget);
    }
}
