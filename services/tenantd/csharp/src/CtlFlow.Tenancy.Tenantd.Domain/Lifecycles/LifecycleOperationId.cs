using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleOperationId
{
    private LifecycleOperationId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<LifecycleOperationId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new LifecycleOperationId(
            OpaqueIdentifiers.Validate(value, "Lifecycle operation ID")));
    }

    public static LifecycleOperationId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(
            value,
            "Lifecycle operation ID"));

    public static LifecycleOperationId Generate() =>
        new(OpaqueIdentifiers.Generate("lop"));

    public override string ToString() => Value;
}
