namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public sealed record AddressBindingGeneration
{
    private AddressBindingGeneration(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static AddressBindingGeneration Initial() => new(1);

    public static AddressBindingGeneration FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored address-binding generation must be positive");
        }

        return new AddressBindingGeneration(value);
    }
}
