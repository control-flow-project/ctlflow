using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public static partial class ProjectionIdentities
{
    private const string Domain = "ctlflow.configuration.v1.Projection";
    private const string Base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

    public static ValueTask<ProjectionId> DeriveProjectionId(
        ProjectionDataKind kind,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var stream = new MemoryStream(512);
        stream.Write(Encoding.ASCII.GetBytes(Domain));
        stream.WriteByte(0);
        stream.WriteByte(kind switch
        {
            ProjectionDataKind.Configuration => 1,
            ProjectionDataKind.Secret => 2,
            _ => throw new InvalidOperationException(
                "Projection data kind is invalid")
        });
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
        var digest = SHA256.HashData(stream.GetBuffer().AsSpan(
            0,
            checked((int)stream.Length)));
        return ValueTask.FromResult(
            ProjectionId.FromDigest(EncodeBase32(digest)));
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

    private static string EncodeBase32(ReadOnlySpan<byte> value)
    {
        Span<char> encoded = stackalloc char[52];
        var buffer = 0;
        var bits = 0;
        var output = 0;
        foreach (var item in value)
        {
            buffer = (buffer << 8) | item;
            bits += 8;
            while (bits >= 5)
            {
                bits -= 5;
                encoded[output++] =
                    Base32Alphabet[(buffer >> bits) & 31];
            }
        }

        if (bits > 0)
        {
            encoded[output++] =
                Base32Alphabet[(buffer << (5 - bits)) & 31];
        }

        if (output != encoded.Length)
        {
            throw new InvalidOperationException(
                "Projection digest encoding failed");
        }

        return new string(encoded);
    }
}
