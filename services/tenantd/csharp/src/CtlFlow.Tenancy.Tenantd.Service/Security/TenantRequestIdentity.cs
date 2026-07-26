using CtlFlow.Tenancy.Tenantd.Service.Security.Callers;
using CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;

namespace CtlFlow.Tenancy.Tenantd.Service.Security;

internal sealed record TenantRequestIdentity(
    AuthenticatedTenantCaller ImmediateCaller,
    InvocationIdentity? Invocation,
    TenantAdmission Admission);
