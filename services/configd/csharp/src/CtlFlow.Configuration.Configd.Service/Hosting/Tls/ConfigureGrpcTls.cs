using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using CtlFlow.Configuration.Configd.Service.Configuration;
using Microsoft.AspNetCore.Server.Kestrel.Https;

namespace CtlFlow.Configuration.Configd.Service.Hosting.Tls;

internal static partial class GrpcTls
{
    internal static void ConfigureGrpcTls(
        HttpsConnectionAdapterOptions options,
        TlsSettings settings)
    {
        options.ServerCertificate = X509Certificate2.CreateFromPemFile(
            settings.CertificatePath,
            settings.PrivateKeyPath);
        options.ClientCertificateMode = ClientCertificateMode.AllowCertificate;
        var clientAuthority = X509CertificateLoader.LoadCertificateFromFile(
            settings.KubernetesClientCertificateAuthorityPath);
        options.ClientCertificateValidation =
            (certificate, _, _) =>
                ValidateClientCertificate(certificate, clientAuthority);
    }

    private static bool ValidateClientCertificate(
        X509Certificate2 certificate,
        X509Certificate2 authority)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(authority);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        chain.ChainPolicy.ApplicationPolicy.Add(
            new Oid("1.3.6.1.5.5.7.3.2"));
        return chain.Build(certificate);
    }
}
