using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security;

internal static partial class AggregationAuthentication
{
    internal static async ValueTask<AggregationCertificates>
        LoadAggregationCertificates(
            AggregationSettings settings,
            CancellationToken cancellation)
    {
        var certificateBytes = await File.ReadAllBytesAsync(
            settings.CertificatePath,
            cancellation);
        var privateKeyPem = await File.ReadAllTextAsync(
            settings.PrivateKeyPath,
            cancellation);
        using var publicCertificate =
            X509CertificateLoader.LoadCertificate(certificateBytes);
        var serverCertificate = AttachPrivateKey(
            publicCertificate,
            privateKeyPem);

        try
        {
            var requestHeaderRootBytes = await File.ReadAllBytesAsync(
                settings.RequestHeaderClientCertificateAuthorityPath,
                cancellation);
            var requestHeaderRoot =
                X509CertificateLoader.LoadCertificate(
                    requestHeaderRootBytes);
            return new AggregationCertificates(
                serverCertificate,
                requestHeaderRoot);
        }
        catch
        {
            serverCertificate.Dispose();
            throw;
        }
    }

    private static X509Certificate2 AttachPrivateKey(
        X509Certificate2 certificate,
        string privateKeyPem)
    {
        using (var publicKey = certificate.GetRSAPublicKey())
        {
            if (publicKey is not null)
            {
                using var privateKey = RSA.Create();
                privateKey.ImportFromPem(privateKeyPem);
                return certificate.CopyWithPrivateKey(privateKey);
            }
        }

        using (var publicKey = certificate.GetECDsaPublicKey())
        {
            if (publicKey is not null)
            {
                using var privateKey = ECDsa.Create();
                privateKey.ImportFromPem(privateKeyPem);
                return certificate.CopyWithPrivateKey(privateKey);
            }
        }

        throw new CryptographicException(
            "Aggregation serving certificate uses an unsupported key algorithm.");
    }
}
