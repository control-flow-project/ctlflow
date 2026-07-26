using System.Text.Json;

namespace CtlFlow.Identity.Identityd.Service.Security.Tokens;

internal sealed record CommonTokenClaims(
    string Subject,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    JsonElement Payload);
