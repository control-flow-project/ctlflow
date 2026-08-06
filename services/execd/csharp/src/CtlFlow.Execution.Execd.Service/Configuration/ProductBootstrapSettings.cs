namespace CtlFlow.Execution.Execd.Service.Configuration;

// The distro-neutral runtime bootstrap projected into every realized
// application container: identity, trust, endpoints, validation settings, and
// the admitted App ID. Package ID, operation grants, and policy state are
// deliberately absent.
internal sealed record ProductBootstrapSettings(
    Uri IdentityEndpoint,
    string IdentityCertificateAuthority,
    Uri PolicyEndpoint,
    string PolicyCertificateAuthority,
    string WorkloadVerificationKeySet,
    string WorkloadTokenIssuer,
    string WorkloadTokenAudience,
    long WorkloadTokenMaximumLifetimeSeconds,
    string InvocationIssuer,
    string InvocationAudience);
