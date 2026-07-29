using System.Diagnostics;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using CtlFlow.Egress.Egressd.Service.Configuration;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static HttpClient CreateUpstreamClient(ProxySettings settings)
    {
        var roots = new X509Certificate2Collection();
        roots.ImportFromPemFile(settings.CertificateAuthorityPath);
        if (roots.Count == 0)
        {
            throw new InvalidOperationException(
                "Upstream TLS trust bundle contains no certificate");
        }

        var chainPolicy = new X509ChainPolicy
        {
            TrustMode = X509ChainTrustMode.CustomRootTrust,
            RevocationMode = X509RevocationMode.NoCheck,
            VerificationFlags = X509VerificationFlags.NoFlag
        };
        chainPolicy.CustomTrustStore.AddRange(roots);
        var handler = new SocketsHttpHandler
        {
            ActivityHeadersPropagator =
                DistributedContextPropagator.CreateNoOutputPropagator(),
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            MaxConnectionsPerServer = settings.MaximumConcurrency,
            MaxResponseHeadersLength = 64,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            UseCookies = false,
            UseProxy = false,
            SslOptions =
            {
                CertificateChainPolicy = chainPolicy
            }
        };
        return new HttpClient(handler, disposeHandler: true)
        {
            BaseAddress = settings.Origin,
            DefaultRequestVersion = HttpVersion.Version20,
            DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower,
            Timeout = Timeout.InfiniteTimeSpan
        };
    }
}
