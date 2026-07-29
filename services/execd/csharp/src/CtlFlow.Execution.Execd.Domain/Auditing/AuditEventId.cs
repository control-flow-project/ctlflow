using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace CtlFlow.Execution.Execd.Domain.Auditing;

public sealed record AuditEventId
{
    private AuditEventId(string value) => Value = value;

    public string Value { get; }

    public static AuditEventId Create(
        string resourceKind,
        string resourceId,
        long revision)
    {
        var key = $"execd/{resourceKind}/{resourceId}/"
            + revision.ToString(CultureInfo.InvariantCulture);
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(key), hash);
        return new AuditEventId(
            "evt_"
            + Convert.ToHexString(hash[..16]).ToLowerInvariant());
    }
}
