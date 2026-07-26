namespace CtlFlow.Tenancy.Tenantd.Domain.Names;

public sealed record DisplayName
{
    private DisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<DisplayName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsCanonical(value))
        {
            throw new ArgumentException("Display name is invalid", nameof(value));
        }

        return ValueTask.FromResult(new DisplayName(value));
    }

    public static DisplayName FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored display name is invalid");
        }

        return new DisplayName(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 200;
}
