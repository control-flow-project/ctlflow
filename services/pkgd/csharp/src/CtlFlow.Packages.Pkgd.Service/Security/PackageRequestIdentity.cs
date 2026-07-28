using CtlFlow.Packages.Pkgd.Service.Security.Callers;
using CtlFlow.Packages.Pkgd.Service.Security.Invocations;

namespace CtlFlow.Packages.Pkgd.Service.Security;

internal sealed record PackageRequestIdentity(
    AuthenticatedPackageCaller ImmediateCaller,
    InvocationIdentity? Invocation,
    PackageAdmission Admission);
