using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Domain.Auditing;

public sealed record AuditEventId
{
    private const string Prefix = "evt_";

    private AuditEventId(string value) => Value = value;

    public string Value { get; }

    public static AuditEventId ForPackage(
        PackageId packageId,
        Generation generation) =>
        Create(
            $"pkgd/package/{packageId.Value}/"
            + generation.Value.ToString(CultureInfo.InvariantCulture));

    public static AuditEventId ForApp(AppId appId, Revision revision) =>
        Create(
            $"pkgd/app/{appId.Value}/"
            + revision.Value.ToString(CultureInfo.InvariantCulture));

    private static AuditEventId Create(string key)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(key), hash);
        return new AuditEventId(
            Prefix + Convert.ToHexString(hash[..16]).ToLowerInvariant());
    }
}
