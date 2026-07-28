namespace CtlFlow.Configuration.Configd.Service.Security.Tokens;

internal delegate Task<VerificationKeySnapshot> VerificationKeyLoader(
    CancellationToken cancellation);
