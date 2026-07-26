namespace CtlFlow.Identity.Identityd.Domain.Keys;

public sealed record VerificationKeyId
{
    private VerificationKeyId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static VerificationKeyId Parse(string value)
    {
        if (!IsCanonical(value))
        {
            throw new ArgumentException(
                "Verification key ID is not canonical",
                nameof(value));
        }

        return new VerificationKeyId(value);
    }

    public static VerificationKeyId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException(
                "Stored verification key ID is not canonical");
        }

        return new VerificationKeyId(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value) =>
        !string.IsNullOrEmpty(value)
        && value.Length <= 128
        && !value.Any(character => character is < ' ' or > '~');
}
