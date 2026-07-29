using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    private static string CreateDependencyClaimId(
        WorkloadId workloadId,
        ComponentId componentId,
        DependencyName dependencyName)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(
            "execution.schemas.ctlflow.com/v1/DependencyClaim"u8);
        AppendLengthAndValue(hash, workloadId.Value);
        AppendLengthAndValue(hash, componentId.Value);
        AppendLengthAndValue(hash, dependencyName.Value);
        return $"dpc-{Convert.ToHexString(
            hash.GetHashAndReset().AsSpan(0, 16)).ToLowerInvariant()}";
    }

    private static void AppendLengthAndValue(
        IncrementalHash hash,
        string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }
}
