using CtlFlow.Auth.Authd.Domain.State;

namespace CtlFlow.Auth.Authd.Service.State;

internal sealed class StoredAuthenticationAttempt(
    byte[] stateDigest,
    byte[] nonceDigest,
    AuthenticationAttempt attempt)
    : IDisposable
{
    internal byte[] StateDigest { get; } = stateDigest;

    internal byte[] NonceDigest { get; } = nonceDigest;

    internal AuthenticationAttempt Attempt { get; } = attempt;

    public void Dispose()
    {
        System.Security.Cryptography.CryptographicOperations.ZeroMemory(
            StateDigest);
        System.Security.Cryptography.CryptographicOperations.ZeroMemory(
            NonceDigest);
        Attempt.Dispose();
    }
}
