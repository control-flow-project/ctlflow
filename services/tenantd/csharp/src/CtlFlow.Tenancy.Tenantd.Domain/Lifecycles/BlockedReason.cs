using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record BlockedReason
{
    private const int MaximumLength = 200;

    private BlockedReason(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<BlockedReason> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new BlockedReason(
            BoundedText.Validate(value, MaximumLength, "Blocked reason")));
    }

    public static BlockedReason FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "blocked reason"));

    public override string ToString() => Value;
}
