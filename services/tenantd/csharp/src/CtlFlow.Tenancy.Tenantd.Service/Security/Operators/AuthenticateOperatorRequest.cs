using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Callers;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Operators;

internal static partial class OperatorAuthentication
{
    internal static async ValueTask<TenantRequestIdentity>
        AuthenticateOperatorRequest(
            ServerCallContext context,
            IReadOnlySet<KubernetesOperatorSubject> allowedSubjects)
    {
        var certificate = await context.GetHttpContext()
            .Connection
            .GetClientCertificateAsync(context.CancellationToken);
        if (certificate is null)
        {
            throw new TokenValidationException();
        }

        KubernetesOperatorSubject subject;
        try
        {
            subject = KubernetesOperatorSubject.FromCertificate(certificate);
        }
        catch (InvalidOperationException)
        {
            throw new TokenValidationException();
        }

        if (!allowedSubjects.Contains(subject))
        {
            throw new CallerNotAdmittedException();
        }

        return new TenantRequestIdentity(
            new AuthenticatedTenantCaller.Operator(subject),
            null,
            TenantAdmission.Operator);
    }
}
