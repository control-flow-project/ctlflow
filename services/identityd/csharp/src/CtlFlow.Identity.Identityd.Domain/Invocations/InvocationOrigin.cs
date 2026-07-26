using CtlFlow.Identity.Identityd.Domain.Runs;
using CtlFlow.Identity.Identityd.Domain.Sessions;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public abstract record InvocationOrigin
{
    private InvocationOrigin()
    {
    }

    public sealed record Session(SessionId SessionId) : InvocationOrigin;

    public sealed record Run(RunId RunId) : InvocationOrigin;
}
