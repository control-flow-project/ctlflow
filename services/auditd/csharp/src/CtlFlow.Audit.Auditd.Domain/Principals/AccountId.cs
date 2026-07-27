namespace CtlFlow.Audit.Auditd.Domain.Principals;

public sealed record AccountId
{
    private AccountId(PrincipalId principal)
    {
        Principal = principal;
    }

    public PrincipalId Principal { get; }

    public string Value => Principal.Value;

    public static async ValueTask<AccountId> Parse(
        string value,
        CancellationToken cancellation)
    {
        var principal = await PrincipalId.Parse(value, cancellation);
        if (principal.Kind == PrincipalKind.Virtual)
        {
            throw new ArgumentException(
                "Attached account cannot be virtual",
                nameof(value));
        }

        return new AccountId(principal);
    }

    public static AccountId FromStorage(string value)
    {
        var principal = PrincipalId.FromStorage(value);
        if (principal.Kind == PrincipalKind.Virtual)
        {
            throw new InvalidOperationException(
                "Stored account ID is virtual");
        }

        return new AccountId(principal);
    }

    public override string ToString() => Value;
}
