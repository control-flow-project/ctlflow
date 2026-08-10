using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Accounts;

public class Account
{
    private string _id = null!;

    private Account()
    {
    }

    public Account(
        AccountId id,
        bool enabled,
        Revision revision)
    {
        _id = id.Value;
        Kind = id.Kind;
        Enabled = enabled;
        Revision = revision;
    }

    public AccountId Id => AccountId.FromStorage(_id);

    public AccountKind Kind { get; private set; }

    public bool Enabled { get; private set; }

    public Revision Revision { get; private set; } = null!;
}
