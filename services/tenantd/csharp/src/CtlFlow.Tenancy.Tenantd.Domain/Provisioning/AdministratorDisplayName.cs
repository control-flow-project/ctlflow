using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record AdministratorDisplayName
{
    private const int MaximumLength = 200;

    private AdministratorDisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<AdministratorDisplayName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new AdministratorDisplayName(
            BoundedText.Validate(
                value,
                MaximumLength,
                "Administrator display name")));
    }

    public static AdministratorDisplayName FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "administrator display name"));
}
