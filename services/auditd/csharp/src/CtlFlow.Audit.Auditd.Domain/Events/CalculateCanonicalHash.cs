using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace CtlFlow.Audit.Auditd.Domain.Events;

internal static partial class AuditCanonicalization
{
    internal static string CalculateCanonicalHash(
        AuditEnvelope envelope,
        AuditDetail detail)
    {
        using var writer = new CanonicalHashWriter();
        writer.Append(envelope.OccurredAt.Seconds);
        writer.Append(envelope.OccurredAt.Nanoseconds);
        WriteAttribution(writer, envelope.Attribution);
        WritePartition(writer, envelope.Partition);
        writer.Append(envelope.Correlation.TraceId);
        writer.Append(envelope.Correlation.SpanId);
        writer.Append((int)detail.Kind);
        detail.WriteCanonical(writer);
        return writer.Finish();
    }

    internal static string CalculateEventKey(
        string sourcePrincipal,
        string sourceEventId)
    {
        using var writer = new CanonicalHashWriter();
        writer.Append(sourcePrincipal);
        writer.Append(sourceEventId);
        return writer.Finish();
    }

    internal static void WriteTarget(
        CanonicalHashWriter writer,
        PlacementAuditTarget target)
    {
        writer.Append((int)target.Kind);
        writer.AppendOptional(target.TenantId?.Value);
        writer.AppendOptional(target.WorkspaceId?.Value);
        writer.AppendOptional(target.AccountPrincipalId?.Value);
    }

    internal static void WriteBinding(
        CanonicalHashWriter writer,
        ConsumerBinding binding)
    {
        writer.Append(binding.PlacementId.Value);
        WriteTarget(writer, binding.Target);
        writer.Append(binding.ConsumerId.Value);
        writer.Append(binding.Purpose.Value);
    }

    private static void WriteAttribution(
        CanonicalHashWriter writer,
        AuditAttribution attribution)
    {
        writer.Append((int)attribution.Kind);
        writer.AppendOptional(attribution.OperatorCommonName?.Value);
        writer.AppendOptional(attribution.WorkloadSubject?.Value);
        writer.AppendOptional(attribution.ActorPrincipalId?.Value);
        writer.AppendOptional(attribution.AttachedAccountPrincipalId?.Value);
        writer.AppendOptional(attribution.InvocationWorkloadSubject?.Value);
    }

    private static void WritePartition(
        CanonicalHashWriter writer,
        AuditPartition partition)
    {
        writer.Append((int)partition.Kind);
        writer.AppendOptional(partition.TenantId?.Value);
    }
}

internal sealed class CanonicalHashWriter : IDisposable
{
    private readonly IncrementalHash _hash =
        IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

    internal void Append(string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, bytes.Length);
        _hash.AppendData(length);
        _hash.AppendData(bytes);
    }

    internal void Append(long value) =>
        Append(value.ToString(CultureInfo.InvariantCulture));

    internal void Append(int value) =>
        Append(value.ToString(CultureInfo.InvariantCulture));

    internal void AppendOptional(string? value)
    {
        Append(value is null ? 0 : 1);
        if (value is not null)
        {
            Append(value);
        }
    }

    internal void AppendOptional(long? value)
    {
        Append(value.HasValue ? 1 : 0);
        if (value.HasValue)
        {
            Append(value.Value);
        }
    }

    internal string Finish() =>
        Convert.ToHexString(_hash.GetHashAndReset()).ToLowerInvariant();

    public void Dispose() => _hash.Dispose();
}
