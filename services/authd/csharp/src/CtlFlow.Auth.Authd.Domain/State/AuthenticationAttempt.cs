using CtlFlow.Auth.Authd.Domain.Browser;
using CtlFlow.Auth.Authd.Domain.Identifiers;
using CtlFlow.Auth.Authd.Domain.Oidc;

namespace CtlFlow.Auth.Authd.Domain.State;

public sealed class AuthenticationAttempt : IDisposable
{
    public AuthenticationAttempt(
        TenantId tenantId,
        ProviderId providerId,
        ReturnTarget returnTarget,
        PkceVerifier verifier,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt)
    {
        if (expiresAt <= createdAt)
        {
            throw new ArgumentOutOfRangeException(nameof(expiresAt));
        }

        TenantId = tenantId;
        ProviderId = providerId;
        ReturnTarget = returnTarget;
        Verifier = verifier;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
    }

    public TenantId TenantId { get; }

    public ProviderId ProviderId { get; }

    public ReturnTarget ReturnTarget { get; }

    public PkceVerifier Verifier { get; }

    public DateTimeOffset CreatedAt { get; }

    public DateTimeOffset ExpiresAt { get; }

    public void Dispose() => Verifier.Dispose();
}
