namespace CtlFlow.Packages.Pkgd.Service.Security.Tokens;

internal delegate Task<VerificationKeySnapshot> VerificationKeyLoader(
    CancellationToken cancellation);
