using System.Security.Cryptography;

namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public sealed record SessionId
{
    private SessionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static SessionId Generate() =>
        new(Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant());

    public static SessionId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException(
                "Stored Session ID is invalid");
        }

        return new SessionId(value);
    }

    private static bool IsCanonical(string value)
    {
        if (value.Length != 32)
        {
            return false;
        }

        foreach (var character in value)
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
