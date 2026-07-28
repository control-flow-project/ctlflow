namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal sealed record VerifiedWorkload(
    string NamespaceName,
    string ServiceAccountName,
    string ServiceAccountUid);
