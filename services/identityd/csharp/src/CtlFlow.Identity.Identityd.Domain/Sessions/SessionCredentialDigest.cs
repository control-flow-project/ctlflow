namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public sealed record SessionCredentialDigest
{
    private SessionCredentialDigest(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static SessionCredentialDigest FromDigest(string value) =>
        IsCanonical(value)
            ? new SessionCredentialDigest(value)
            : throw new ArgumentException(
                "Session credential digest is invalid",
                nameof(value));

    public static SessionCredentialDigest FromStorage(string value) =>
        IsCanonical(value)
            ? new SessionCredentialDigest(value)
            : throw new InvalidOperationException(
                "Stored Session credential digest is invalid");

    private static bool IsCanonical(string value)
    {
        if (value.Length != 64)
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
