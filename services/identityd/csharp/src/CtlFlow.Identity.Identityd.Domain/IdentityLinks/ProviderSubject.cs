namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public sealed record ProviderSubject
{
    private const int MaximumLength = 512;

    private ProviderSubject(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ProviderSubject Parse(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            throw new ArgumentException(
                "Provider subject is invalid",
                nameof(value));
        }

        return new ProviderSubject(value);
    }

    public static ProviderSubject FromStorage(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            throw new InvalidOperationException(
                "Stored provider subject is invalid");
        }

        return new ProviderSubject(value);
    }
}
