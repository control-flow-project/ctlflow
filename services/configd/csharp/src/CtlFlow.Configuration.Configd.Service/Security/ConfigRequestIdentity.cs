using CtlFlow.Configuration.Configd.Service.Security.Callers;
using CtlFlow.Configuration.Configd.Service.Security.Invocations;

namespace CtlFlow.Configuration.Configd.Service.Security;

internal sealed record ConfigRequestIdentity(
    AuthenticatedConfigCaller ImmediateCaller,
    InvocationIdentity? Invocation,
    ConfigAdmission Admission);
