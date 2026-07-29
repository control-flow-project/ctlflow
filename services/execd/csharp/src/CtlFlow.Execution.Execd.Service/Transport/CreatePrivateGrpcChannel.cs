using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using CtlFlow.Execution.Execd.Service.Configuration;
using Grpc.Net.Client;

namespace CtlFlow.Execution.Execd.Service.Transport;

internal static partial class PrivateGrpcChannels
{
    internal static GrpcChannel CreatePrivateGrpcChannel(
        PrivateGrpcSettings settings,
        TimeSpan connectTimeout)
    {
        var authority = X509CertificateLoader.LoadCertificateFromFile(
            settings.CertificateAuthorityPath);
        var handler = new SocketsHttpHandler
        {
            ConnectTimeout = connectTimeout,
            EnableMultipleHttp2Connections = false,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            SslOptions = new SslClientAuthenticationOptions
            {
                TargetHost = settings.ServerName,
                RemoteCertificateValidationCallback =
                    (_, certificate, _, _) =>
                        certificate is not null
                        && ValidateServerCertificate(
                            certificate,
                            authority,
                            settings.ServerName)
            }
        };
        return GrpcChannel.ForAddress(
            settings.Endpoint,
            new GrpcChannelOptions
            {
                HttpHandler = handler,
                MaxReceiveMessageSize = 64 * 1024,
                MaxSendMessageSize = 64 * 1024
            });
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
