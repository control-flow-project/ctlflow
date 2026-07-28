namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record InterfacePort
{
    private InterfacePort(int value) => Value = value;
    public int Value { get; }

    public static ValueTask<InterfacePort> Parse(
        uint value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(value is >= 1 and <= 65_535
            ? new InterfacePort((int)value)
            : throw new ArgumentException(
                "Interface port must be from 1 through 65535",
                nameof(value)));
    }

    public static InterfacePort FromStorage(int value) =>
        value is >= 1 and <= 65_535
            ? new InterfacePort(value)
            : throw new InvalidOperationException(
                "Stored interface port is invalid");
}
