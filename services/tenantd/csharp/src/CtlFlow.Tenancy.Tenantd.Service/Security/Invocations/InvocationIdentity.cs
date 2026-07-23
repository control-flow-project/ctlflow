using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Security.Principals;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;

internal sealed record InvocationIdentity(
    PrincipalId SubjectAccount,
    PrincipalId Actor,
    TenantId? TenantId,
    string TokenId);
