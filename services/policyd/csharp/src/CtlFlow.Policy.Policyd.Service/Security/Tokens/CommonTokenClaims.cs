using System.Text.Json;

namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

internal sealed record CommonTokenClaims(
    string Subject,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    JsonElement Payload);
