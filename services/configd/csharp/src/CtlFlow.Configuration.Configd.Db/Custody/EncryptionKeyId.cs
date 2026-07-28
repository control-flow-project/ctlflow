namespace CtlFlow.Configuration.Configd.Db.Custody;

public sealed record EncryptionKeyId
{
    private EncryptionKeyId(string value) => Value = value;

    public string Value { get; }

    public static EncryptionKeyId Parse(string value) =>
        IsCanonical(value)
            ? new EncryptionKeyId(value)
            : throw new ArgumentException(
                "Encryption key ID is not canonical",
                nameof(value));

    public static EncryptionKeyId FromStorage(string value) =>
        IsCanonical(value)
            ? new EncryptionKeyId(value)
            : throw new InvalidOperationException(
                "Stored encryption key ID is not canonical");

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > 64
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
