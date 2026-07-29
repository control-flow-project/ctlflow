using CtlFlow.Egress.Egressd.Domain.Bindings;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal sealed record BoundConfiguration(
    EgressBinding Binding,
    SecretValues Secrets);
