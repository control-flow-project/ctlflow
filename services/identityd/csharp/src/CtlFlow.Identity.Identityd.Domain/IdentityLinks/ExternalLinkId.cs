using System.Security.Cryptography;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public sealed record ExternalLinkId
{
    private const string Prefix = "eil_";

    private ExternalLinkId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ExternalLinkId Generate() =>
        new(Prefix + Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant());

    public static ExternalLinkId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException(
                "Stored external-link ID is invalid");
        }

        return new ExternalLinkId(value);
    }

    private static bool IsCanonical(string value)
    {
        if (value.Length != 36
            || !value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return false;
        }

        foreach (var character in value.AsSpan(Prefix.Length))
        {
            if (character is not (
                >= '0' and <= '9'
                or >= 'a' and <= 'f'))
            {
                return false;
            }
        }

        return true;
    }
}
