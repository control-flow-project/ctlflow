using CtlFlow.Identity.Identityd.Domain.Keys;

namespace CtlFlow.Identity.Identityd.Db.Keys;

internal static partial class VerificationKeyValues
{
    internal static int ToStorage(VerificationKeyState value) =>
        value switch
        {
            (VerificationKeyState)0 => 0,
            VerificationKeyState.Active => 1,
            VerificationKeyState.Retiring => 2,
            _ => throw new InvalidOperationException(
                "Unknown verification-key state")
        };

    internal static VerificationKeyState StateFromStorage(int value) =>
        value switch
        {
            1 => VerificationKeyState.Active,
            2 => VerificationKeyState.Retiring,
            _ => throw new InvalidOperationException(
                "Stored verification-key state is invalid")
        };
}
