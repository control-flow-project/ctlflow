namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record DependencyType
{
    private DependencyType(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<DependencyType> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static DependencyType FromStorage(string value) =>
        Create(value, stored: true);

    private static DependencyType Create(string value, bool stored)
    {
        if (value.Length is < 1 or > 128
            || value.Split(':').Any(segment => !ValidateSegment(segment)))
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored dependency type is not canonical")
                : new ArgumentException(
                    "Dependency type is not canonical");
        }

        return new DependencyType(value);
    }

    private static bool ValidateSegment(string value)
    {
        if (value.Length == 0
            || value[0] is not (>= 'a' and <= 'z')
                and not (>= '0' and <= '9'))
        {
            return false;
        }

        return value.AsSpan(1).IndexOfAnyExcept(
            "abcdefghijklmnopqrstuvwxyz0123456789._-") < 0;
    }
}
