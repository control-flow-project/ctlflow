using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesNames
{
    internal static ValueTask<string> DeriveNativeName(
        string domain,
        string prefix,
        string identifier,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var domainBytes = Encoding.ASCII.GetBytes(domain);
        var identifierBytes = Encoding.UTF8.GetBytes(identifier);
        var content = new byte[
            domainBytes.Length + 1 + 4 + identifierBytes.Length];
        domainBytes.CopyTo(content, 0);
        BinaryPrimitives.WriteUInt32BigEndian(
            content.AsSpan(domainBytes.Length + 1, 4),
            checked((uint)identifierBytes.Length));
        identifierBytes.CopyTo(content, domainBytes.Length + 5);
        var digest = SHA256.HashData(content);
        return ValueTask.FromResult(
            prefix + Convert.ToHexString(digest.AsSpan(0, 16))
                .ToLowerInvariant());
    }
}
