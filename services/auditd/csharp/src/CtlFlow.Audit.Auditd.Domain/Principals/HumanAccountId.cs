namespace CtlFlow.Audit.Auditd.Domain.Principals;

public sealed record HumanAccountId
{
    private HumanAccountId(AccountId account)
    {
        Account = account;
    }

    public AccountId Account { get; }

    public string Value => Account.Value;

    public static async ValueTask<HumanAccountId> Parse(
        string value,
        CancellationToken cancellation)
    {
        var account = await AccountId.Parse(value, cancellation);
        if (account.Principal.Kind != PrincipalKind.Human)
        {
            throw new ArgumentException(
                "Human account ID must name a user",
                nameof(value));
        }

        return new HumanAccountId(account);
    }

    public static HumanAccountId FromStorage(string value)
    {
        var account = AccountId.FromStorage(value);
        if (account.Principal.Kind != PrincipalKind.Human)
        {
            throw new InvalidOperationException(
                "Stored human account ID is not a user");
        }

        return new HumanAccountId(account);
    }

    public override string ToString() => Value;
}
