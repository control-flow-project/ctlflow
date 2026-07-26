namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

internal delegate Task<VerificationKeySnapshot> VerificationKeyLoader(
    CancellationToken cancellation);
