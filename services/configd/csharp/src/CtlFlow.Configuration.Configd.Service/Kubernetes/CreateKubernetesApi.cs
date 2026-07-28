using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Telemetry;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static KubernetesApi CreateKubernetesApi(
        KubernetesSettings settings,
        ConfigdTelemetry telemetry)
    {
        var authority = X509CertificateLoader.LoadCertificateFromFile(
            settings.CertificateAuthorityPath);
        var handler = new SocketsHttpHandler
        {
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            MaxConnectionsPerServer = 32,
            SslOptions = new SslClientAuthenticationOptions
            {
                TargetHost = settings.Endpoint.Host,
                RemoteCertificateValidationCallback =
                    (_, certificate, _, _) =>
                        certificate is not null
                        && ValidateServerCertificate(
                            certificate,
                            authority,
                            settings.Endpoint.Host)
            }
        };
        return new KubernetesApi(
            new HttpClient(handler)
            {
                BaseAddress = settings.Endpoint,
                Timeout = Timeout.InfiniteTimeSpan
            },
            settings,
            telemetry);
    }

    private static bool ValidateServerCertificate(
        X509Certificate certificate,
        X509Certificate2 authority,
        string serverName)
    {
        using var serverCertificate = X509CertificateLoader.LoadCertificate(
            certificate.GetRawCertData());
        if (!serverCertificate.MatchesHostname(
                serverName,
                allowWildcards: false,
                allowCommonName: false))
        {
            return false;
        }

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(authority);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        return chain.Build(serverCertificate);
    }
}
