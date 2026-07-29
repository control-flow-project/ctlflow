namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record ProvisionerSubject
{
    private const string Prefix = "system:serviceaccount:";

    private ProvisionerSubject(string value) => Value = value;

    public string Value { get; }

    public static ProvisionerSubject Parse(string value)
    {
        if (!value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "provisioner_subject is invalid",
                nameof(value));
        }

        var segments = value[Prefix.Length..].Split(':');
        if (segments.Length != 2
            || !IsDnsLabel(segments[0])
            || !IsDnsLabel(segments[1]))
        {
            throw new ArgumentException(
                "provisioner_subject is invalid",
                nameof(value));
        }

        return new ProvisionerSubject(value);
    }

    public override string ToString() => Value;

    private static bool IsDnsLabel(string value)
    {
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1]))
        {
            return false;
        }

        return value.All(character =>
            IsLowerAlphaNumeric(character) || character == '-');
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
