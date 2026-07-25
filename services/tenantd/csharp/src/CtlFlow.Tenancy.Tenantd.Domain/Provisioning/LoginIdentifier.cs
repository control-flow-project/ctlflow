using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record LoginIdentifier
{
    private const int MaximumLength = 320;

    private LoginIdentifier(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<LoginIdentifier> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new LoginIdentifier(
            BoundedText.Validate(value, MaximumLength, "Login identifier")));
    }

    public static LoginIdentifier FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "login identifier"));
}
