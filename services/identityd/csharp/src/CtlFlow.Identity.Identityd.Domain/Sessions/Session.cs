using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public class Session
{
    private string _accountId = null!;
    private string _credentialDigest = null!;
    private string _id = null!;
    private string _providerId = null!;
    private string _tenantId = null!;

    private Session()
    {
    }

    public Session(
        SessionId id,
        SessionCredentialDigest credentialDigest,
        AccountId accountId,
        TenantId tenantId,
        ProviderId providerId,
        UtcInstant createdAt,
        UtcInstant expiresAt,
        UtcInstant? revokedAt,
        Revision revision)
    {
        if (expiresAt.Value <= createdAt.Value
            || revokedAt is not null
                && revokedAt.Value < createdAt.Value)
        {
            throw new InvalidOperationException(
                "Stored Session state is invalid");
        }

        _id = id.Value;
        _credentialDigest = credentialDigest.Value;
        _accountId = accountId.Value;
        _tenantId = tenantId.Value;
        _providerId = providerId.Value;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
        RevokedAt = revokedAt;
        Revision = revision;
    }

    public SessionId Id => SessionId.FromStorage(_id);

    public SessionCredentialDigest CredentialDigest =>
        SessionCredentialDigest.FromStorage(_credentialDigest);

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public ProviderId ProviderId => ProviderId.FromStorage(_providerId);

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant ExpiresAt { get; private set; } = null!;

    public UtcInstant? RevokedAt { get; private set; }

    public Revision Revision { get; private set; } = null!;

    internal void Revoke(UtcInstant occurredAt)
    {
        if (RevokedAt is not null)
        {
            return;
        }

        RevokedAt = occurredAt;
        Revision = Revision.Next();
    }
}
