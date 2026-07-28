namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

internal delegate Task<VerificationKeySnapshot> VerificationKeyLoader(
    CancellationToken cancellation);
