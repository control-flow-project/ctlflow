using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Domain.Bindings;

public sealed record EgressBinding(
    BindingId BindingId,
    CallerBinding Caller,
    EgressOrigin Origin,
    IReadOnlyList<EgressRule> Rules);
