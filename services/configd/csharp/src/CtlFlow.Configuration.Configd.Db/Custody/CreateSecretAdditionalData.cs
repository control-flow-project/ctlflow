using System.Buffers.Binary;
using System.Text;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    private const string EnvelopeDomain =
        "ctlflow.configuration.v1.SecretEnvelope";

    internal static byte[] CreateSecretAdditionalData(
        EncryptionKeyId keyId,
        SecretId secretId,
        SecretVersionId versionId,
        ConsumerBinding binding)
    {
        using var stream = new MemoryStream(512);
        stream.Write(Encoding.ASCII.GetBytes(EnvelopeDomain));
        stream.WriteByte(0);
        WriteField(stream, keyId.Value);
        WriteField(stream, secretId.Value);
        WriteField(stream, versionId.Value);
        WriteField(stream, binding.Placement.PlacementId.Value);
        switch (binding.Placement.Scope)
        {
            case PlacementScope.Global:
                stream.WriteByte(1);
                break;
            case PlacementScope.Tenant tenant:
                stream.WriteByte(2);
                WriteField(stream, tenant.TenantId.Value);
                break;
            case PlacementScope.Workspace workspace:
                stream.WriteByte(3);
                WriteField(stream, workspace.TenantId.Value);
                WriteField(stream, workspace.WorkspaceId.Value);
                break;
            case PlacementScope.User user:
                stream.WriteByte(4);
                WriteField(stream, user.TenantId.Value);
                WriteField(stream, user.AccountPrincipalId.Value);
                break;
            default:
                throw new InvalidOperationException(
                    "Placement scope is invalid");
        }

        WriteField(stream, binding.ConsumerId.Value);
        WriteField(stream, binding.Purpose.Value);
        return stream.ToArray();
    }

    private static void WriteField(Stream stream, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(
            length,
            checked((uint)bytes.Length));
        stream.Write(length);
        stream.Write(bytes);
    }
}
