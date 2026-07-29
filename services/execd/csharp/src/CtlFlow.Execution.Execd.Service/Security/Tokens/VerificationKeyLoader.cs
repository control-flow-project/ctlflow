namespace CtlFlow.Execution.Execd.Service.Security.Tokens;

internal delegate Task<VerificationKeySnapshot> VerificationKeyLoader(
    CancellationToken cancellation);
