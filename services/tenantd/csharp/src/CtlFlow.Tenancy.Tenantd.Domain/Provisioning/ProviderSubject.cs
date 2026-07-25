using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record ProviderSubject
{
    private const int MaximumLength = 512;

    private ProviderSubject(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProviderSubject> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ProviderSubject(
            BoundedText.Validate(value, MaximumLength, "Provider subject")));
    }

    public static ProviderSubject FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "provider subject"));
}
