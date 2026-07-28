namespace CtlFlow.Policy.Policyd.Domain.Grants;

public readonly record struct AccessGrantId
{
    private AccessGrantId(long value) => Value = value;

    public long Value { get; }

    public static AccessGrantId FromStorage(long value) =>
        value > 0
            ? new AccessGrantId(value)
            : throw new InvalidOperationException(
                "Stored access-grant identity is invalid");
}
