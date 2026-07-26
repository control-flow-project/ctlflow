namespace CtlFlow.Identity.Identityd.Service.Security;

internal sealed class CallerNotAdmittedException : Exception
{
    internal CallerNotAdmittedException()
        : base("The authenticated workload is not admitted")
    {
    }
}
