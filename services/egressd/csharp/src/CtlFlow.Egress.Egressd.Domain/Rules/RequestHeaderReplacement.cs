namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record RequestHeaderReplacement(
    HeaderName Name,
    RequestHeaderValue Value);
