using System.Security.Cryptography.X509Certificates;
using CtlFlow.Audit.Auditd.Service.Configuration;
using Microsoft.AspNetCore.Server.Kestrel.Https;

namespace CtlFlow.Audit.Auditd.Service.Hosting.Tls;

internal static partial class GrpcTls
{
    internal static void ConfigureGrpcTls(
        HttpsConnectionAdapterOptions options,
        TlsSettings settings)
    {
        options.ServerCertificate = X509Certificate2.CreateFromPemFile(
            settings.CertificatePath,
            settings.PrivateKeyPath);
        options.ClientCertificateMode = ClientCertificateMode.NoCertificate;
    }
}
