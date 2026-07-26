using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Accounts;

public sealed record AccountId
{
    private AccountId(PrincipalId principal)
    {
        Principal = principal;
    }

    public string Value => Principal.Value;

    public AccountKind Kind => Principal.Kind switch
    {
        PrincipalKind.Human => AccountKind.Human,
        PrincipalKind.Service => AccountKind.Service,
        _ => throw new InvalidOperationException(
            "A virtual principal is not an account")
    };

    public PrincipalId Principal { get; }

    public static async ValueTask<AccountId> Parse(
        string value,
        CancellationToken cancellation)
    {
        var principal = await PrincipalId.Parse(value, cancellation);
        if (principal.Kind == PrincipalKind.Virtual)
        {
            throw new ArgumentException("Account ID is virtual", nameof(value));
        }

        return new AccountId(principal);
    }

    public static AccountId FromStorage(string value)
    {
        var principal = PrincipalId.FromStorage(value);
        if (principal.Kind == PrincipalKind.Virtual)
        {
            throw new InvalidOperationException("Stored account ID is virtual");
        }

        return new AccountId(principal);
    }

    public override string ToString() => Value;
}
