using System.Net;
using CtlFlow.Edge.Edged.Service.Configuration;

namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    internal static HttpClient CreateApplicationClient(
        ProxySettings settings)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(2),
            MaxConnectionsPerServer = settings.MaximumConcurrency,
            MaxResponseHeadersLength = 64,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            UseCookies = false,
            UseProxy = false
        };
        return new HttpClient(handler, disposeHandler: true)
        {
            BaseAddress = settings.ApplicationOrigin,
            DefaultRequestVersion = HttpVersion.Version11,
            DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Timeout = Timeout.InfiniteTimeSpan
        };
    }
}
