using System.Security.Cryptography.X509Certificates;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security;

internal sealed class AggregationCertificates(
    X509Certificate2 serverCertificate,
    X509Certificate2 requestHeaderRoot) : IDisposable
{
    internal X509Certificate2 ServerCertificate { get; } =
        serverCertificate;

    internal X509Certificate2 RequestHeaderRoot { get; } =
        requestHeaderRoot;

    public void Dispose()
    {
        ServerCertificate.Dispose();
        RequestHeaderRoot.Dispose();
    }
}
