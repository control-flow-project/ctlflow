using System.Security.Cryptography;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public sealed record AuditEventId
{
    private AuditEventId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditEventId Generate() =>
        new(Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant());
}
