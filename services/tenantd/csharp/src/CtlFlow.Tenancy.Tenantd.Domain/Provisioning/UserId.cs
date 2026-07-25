using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record UserId
{
    private UserId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<UserId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new UserId(
            OpaqueIdentifiers.Validate(value, "User ID")));
    }

    public static UserId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(value, "user ID"));
}
