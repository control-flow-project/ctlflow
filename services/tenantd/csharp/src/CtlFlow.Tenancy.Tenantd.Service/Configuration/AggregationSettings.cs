using System.Net;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record AggregationSettings(
    IPAddress Address,
    int Port,
    string CertificatePath,
    string PrivateKeyPath,
    string RequestHeaderClientCertificateAuthorityPath,
    IReadOnlySet<string> AllowedClientNames);
