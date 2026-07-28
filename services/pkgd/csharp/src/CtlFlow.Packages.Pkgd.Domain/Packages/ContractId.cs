namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record ContractId
{
    private ContractId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<ContractId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static ContractId FromStorage(string value) =>
        Create(value, stored: true);

    private static ContractId Create(string value, bool stored)
    {
        if (value.Length is < 1 or > 128
            || value.Split('.').Any(segment => !ValidateSegment(segment)))
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored contract ID is not canonical")
                : new ArgumentException("Contract ID is not canonical");
        }

        return new ContractId(value);
    }

    private static bool ValidateSegment(string value)
    {
        if (value.Length == 0 || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        return value.AsSpan(1).IndexOfAnyExcept(
            "abcdefghijklmnopqrstuvwxyz0123456789_-") < 0;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
