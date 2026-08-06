using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace CtlFlow.Execution.Execd.Domain.Naming;

public static partial class NativeNames
{
    public static string CreateNativeToken(string domain, string id)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.ASCII.GetBytes(domain));
        hash.AppendData([0]);
        AppendLengthAndValue(hash, id);
        return Convert.ToHexString(hash.GetHashAndReset().AsSpan(0, 16))
            .ToLowerInvariant();
    }

    private static void AppendLengthAndValue(IncrementalHash hash, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }
}
