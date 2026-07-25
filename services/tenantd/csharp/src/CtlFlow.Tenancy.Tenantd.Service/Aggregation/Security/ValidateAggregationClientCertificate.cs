using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security;

internal static partial class AggregationAuthentication
{
    internal static bool ValidateAggregationClientCertificate(
        X509Certificate2? certificate,
        X509Chain? _,
        SslPolicyErrors errors,
        X509Certificate2 requestHeaderRoot,
        IReadOnlySet<string> allowedClientNames)
    {
        if (certificate is null
            || errors.HasFlag(
                SslPolicyErrors.RemoteCertificateNotAvailable))
        {
            return false;
        }

        var clientName = certificate.GetNameInfo(
            X509NameType.SimpleName,
            forIssuer: false);
        if (!allowedClientNames.Contains(clientName))
        {
            return false;
        }

        using var validationChain = new X509Chain();
        validationChain.ChainPolicy.TrustMode =
            X509ChainTrustMode.CustomRootTrust;
        validationChain.ChainPolicy.CustomTrustStore.Add(requestHeaderRoot);
        validationChain.ChainPolicy.RevocationMode =
            X509RevocationMode.NoCheck;
        validationChain.ChainPolicy.VerificationFlags =
            X509VerificationFlags.NoFlag;
        return validationChain.Build(certificate);
    }
}
