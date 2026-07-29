using CtlFlow.Execution.Execd.Service.Security.Callers;
using CtlFlow.Execution.Execd.Service.Security.Invocations;

namespace CtlFlow.Execution.Execd.Service.Security;

internal sealed record ExecutionRequestIdentity(
    AuthenticatedExecutionCaller ImmediateCaller,
    InvocationIdentity? Invocation,
    ExecutionAdmission Admission);
