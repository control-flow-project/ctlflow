using System.Security.Cryptography;

namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditEventId
{
    private AuditEventId(string value) => Value = value;

    public string Value { get; }

    public static AuditEventId Generate() =>
        new($"evt_{Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()}");

    public static AuditEventId FromStorage(string value) =>
        value.Length == 36
        && value.StartsWith("evt_", StringComparison.Ordinal)
        && value.AsSpan(4).IndexOfAnyExcept(
            "0123456789abcdef".AsSpan()) < 0
            ? new AuditEventId(value)
            : throw new InvalidOperationException(
                "Stored audit event ID is invalid");
}
