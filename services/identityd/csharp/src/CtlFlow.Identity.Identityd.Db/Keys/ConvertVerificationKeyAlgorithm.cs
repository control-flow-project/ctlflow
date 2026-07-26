using CtlFlow.Identity.Identityd.Domain.Keys;

namespace CtlFlow.Identity.Identityd.Db.Keys;

internal static partial class VerificationKeyValues
{
    internal static string ToStorage(VerificationKeyAlgorithm value) =>
        value switch
        {
            (VerificationKeyAlgorithm)0 => "",
            VerificationKeyAlgorithm.Rs256 => "RS256",
            _ => throw new InvalidOperationException(
                "Unknown verification-key algorithm")
        };

    internal static VerificationKeyAlgorithm AlgorithmFromStorage(
        string value) =>
        value switch
        {
            "RS256" => VerificationKeyAlgorithm.Rs256,
            _ => throw new InvalidOperationException(
                "Stored verification-key algorithm is invalid")
        };
}
