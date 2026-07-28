namespace CtlFlow.Packages.Pkgd.Service.Security;

internal sealed class CallerNotAdmittedException : Exception
{
    internal CallerNotAdmittedException()
        : base("The authenticated caller is not admitted")
    {
    }
}
