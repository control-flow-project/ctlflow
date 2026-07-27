namespace CtlFlow.Auth.Authd.Domain.Oidc;

public sealed record ProviderSubject
{
    private ProviderSubject(string value) => Value = value;

    public string Value { get; }

    public static ProviderSubject Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 255)
        {
            throw new ArgumentException(
                "Provider subject has an invalid length",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character is < (char)0x20 or > (char)0x7e)
            {
                throw new ArgumentException(
                    "Provider subject must be ASCII",
                    nameof(value));
            }
        }

        return new ProviderSubject(value);
    }

    public override string ToString() => "[REDACTED]";
}
