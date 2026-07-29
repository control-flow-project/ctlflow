namespace CtlFlow.Execution.Execd.Service.Security;

internal sealed class CallerNotAdmittedException : Exception
{
    internal CallerNotAdmittedException()
        : base("The authenticated caller is not admitted")
    {
    }
}
