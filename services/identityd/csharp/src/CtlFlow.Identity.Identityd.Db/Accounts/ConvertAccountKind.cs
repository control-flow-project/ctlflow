using CtlFlow.Identity.Identityd.Domain.Accounts;

namespace CtlFlow.Identity.Identityd.Db.Accounts;

internal static partial class AccountKinds
{
    internal static int ToStorage(AccountKind value) =>
        value switch
        {
            (AccountKind)0 => 0,
            AccountKind.Human => 1,
            AccountKind.Service => 2,
            _ => throw new InvalidOperationException("Unknown account kind")
        };

    internal static AccountKind FromStorage(int value) =>
        value switch
        {
            1 => AccountKind.Human,
            2 => AccountKind.Service,
            _ => throw new InvalidOperationException(
                "Stored account kind is invalid")
        };
}
