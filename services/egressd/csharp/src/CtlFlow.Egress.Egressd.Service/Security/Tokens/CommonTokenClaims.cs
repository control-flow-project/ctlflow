using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal sealed record CommonTokenClaims(
    string Subject,
    JsonElement Payload);
