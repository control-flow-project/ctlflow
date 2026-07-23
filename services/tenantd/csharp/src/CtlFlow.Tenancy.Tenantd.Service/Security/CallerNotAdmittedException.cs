namespace CtlFlow.Tenancy.Tenantd.Service.Security;

internal sealed class CallerNotAdmittedException : Exception
{
    internal CallerNotAdmittedException()
        : base("The authenticated caller is not admitted")
    {
    }
}
