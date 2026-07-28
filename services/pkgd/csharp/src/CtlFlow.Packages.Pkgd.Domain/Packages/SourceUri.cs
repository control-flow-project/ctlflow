namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record SourceUri
{
    private SourceUri(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<SourceUri> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static SourceUri FromStorage(string value) =>
        Create(value, stored: true);

    private static SourceUri Create(string value, bool stored)
    {
        if (value.Length is < 1 or > 2_048
            || value.Any(character => character is < '!' or > '~')
            || !value.StartsWith("https://", StringComparison.Ordinal)
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || Uri.CheckHostName(uri.Host) != UriHostNameType.Dns
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored source URI is not canonical")
                : new ArgumentException("Source URI is not canonical");
        }

        return new SourceUri(value);
    }
}
