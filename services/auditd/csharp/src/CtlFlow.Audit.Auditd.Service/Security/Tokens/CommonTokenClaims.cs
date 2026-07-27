using System.Text.Json;

namespace CtlFlow.Audit.Auditd.Service.Security.Tokens;

internal sealed record CommonTokenClaims(
    string Subject,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    JsonElement Payload);
