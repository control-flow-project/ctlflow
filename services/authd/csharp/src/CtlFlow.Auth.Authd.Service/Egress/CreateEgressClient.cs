namespace CtlFlow.Auth.Authd.Service.Egress;

internal static partial class EgressClients
{
    internal static HttpClient CreateEgressClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression =
                System.Net.DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            MaxConnectionsPerServer = 32,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            UseCookies = false,
            UseProxy = false
        };
        return new HttpClient(handler, disposeHandler: true)
        {
            Timeout = Timeout.InfiniteTimeSpan,
            MaxResponseContentBufferSize = 256 * 1024
        };
    }
}
