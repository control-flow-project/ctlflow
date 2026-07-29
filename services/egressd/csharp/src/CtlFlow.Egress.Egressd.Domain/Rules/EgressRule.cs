namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record EgressRule(
    RuleId RuleId,
    IReadOnlySet<EgressMethod> Methods,
    PathMatch Match,
    RulePath UpstreamPathPrefix,
    IReadOnlySet<HeaderName> ForwardRequestHeaders,
    IReadOnlySet<HeaderName> ForwardResponseHeaders,
    IReadOnlyList<RequestHeaderReplacement> SetRequestHeaders,
    long MaximumRequestBodyBytes,
    long MaximumResponseBodyBytes,
    bool ForwardTraceContext);
