using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

public static class NativeNames
{
    public static string PlacementNamespace(PlacementId placementId) =>
        $"plc-{CreateNativeToken(
            "ctlflow.execution.v1.PlacementNamespace",
            placementId.Value)}";

    public static string WorkloadServiceAccount(WorkloadId workloadId) =>
        $"wld-{CreateNativeToken(
            "ctlflow.execution.v1.WorkloadServiceAccount",
            workloadId.Value)}";

    public static string RunJob(RunId runId) =>
        $"run-{CreateNativeToken(
            "ctlflow.execution.v1.RunJob",
            runId.Value)}";

    public static string RunInvocationSecret(RunId runId) =>
        $"inv-{CreateNativeToken(
            "ctlflow.execution.v1.RunInvocationSecret",
            runId.Value)}";

    public static string EdgedTrustConfigMap(WorkloadId workloadId) =>
        $"etr-{CreateNativeToken(
            "ctlflow.execution.v1.EdgedTrustConfigMap",
            workloadId.Value)}";

    public static string StorageClaim(
        WorkloadId workloadId,
        StorageId storageId) =>
        $"vol-{CreateNativeToken(
            "ctlflow.execution.v1.StorageClaim",
            $"{workloadId.Value}/{storageId.Value}")}";

    public static string InterfaceService(
        WorkloadId workloadId,
        InterfaceId interfaceId) =>
        $"ifc-{CreateNativeToken(
            "ctlflow.execution.v1.InterfaceService",
            $"{workloadId.Value}/{interfaceId.Value}")}";

    public static string ProjectionObject(ProjectionId projectionId) =>
        $"prj-{CreateNativeToken(
            "ctlflow.configuration.v1.ProjectionObject",
            projectionId.Value)}";

    public static string ProjectionMountPath(
        DataKind kind,
        Purpose purpose) =>
        kind switch
        {
            DataKind.Configuration =>
                $"/run/ctlflow/configurations/{purpose.Value}/content",
            DataKind.Secret =>
                $"/run/ctlflow/secrets/{purpose.Value}/content",
            _ => throw new InvalidOperationException("Data kind is invalid")
        };

    private static string CreateNativeToken(string domain, string id)
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
