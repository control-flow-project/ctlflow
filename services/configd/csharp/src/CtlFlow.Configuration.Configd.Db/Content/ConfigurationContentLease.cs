using CtlFlow.Configuration.Configd.Domain.Content;

namespace CtlFlow.Configuration.Configd.Db.Content;

public sealed class ConfigurationContentLease : IDisposable
{
    private byte[]? _content;

    internal ConfigurationContentLease(byte[] content)
    {
        _content = content;
        Reference = new ConfigurationContentReference(
            ContentLength.FromValidatedContent(content.Length),
            ConfigurationDigest.FromValidatedContent(content));
    }

    public ConfigurationContentReference Reference { get; }

    public void CopyTo(Span<byte> destination)
    {
        var content = RequireContent();
        if (destination.Length < content.Length)
        {
            throw new ArgumentException(
                "Configuration destination is too small",
                nameof(destination));
        }

        content.CopyTo(destination);
    }

    internal byte[] Copy()
    {
        var content = RequireContent();
        return content.ToArray();
    }

    public bool Matches(ReadOnlySpan<byte> other) =>
        RequireContent().AsSpan().SequenceEqual(other);

    public void Dispose()
    {
        _content = null;
    }

    internal ReadOnlyMemory<byte> Memory => RequireContent();

    private byte[] RequireContent() =>
        _content ?? throw new ObjectDisposedException(
            nameof(ConfigurationContentLease));
}
