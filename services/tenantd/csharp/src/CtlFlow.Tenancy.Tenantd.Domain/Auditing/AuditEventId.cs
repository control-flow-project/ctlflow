using System.Security.Cryptography;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditEventId
{
    private const string Prefix = "evt_";

    private AuditEventId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditEventId Generate() =>
        new(Prefix + Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant());

    public static AuditEventId FromStorage(string value)
    {
        if (value.Length != Prefix.Length + 32
            || !value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Stored audit event ID is invalid");
        }

        foreach (var character in value.AsSpan(Prefix.Length))
        {
            if (character is not (>= '0' and <= '9')
                and not (>= 'a' and <= 'f'))
            {
                throw new InvalidOperationException(
                    "Stored audit event ID is invalid");
            }
        }

        return new AuditEventId(value);
    }

    public override string ToString() => Value;
}
