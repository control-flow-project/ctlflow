using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Callers;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using Grpc.Core;

namespace CtlFlow.Packages.Pkgd.Service.Security.Operators;

internal static partial class OperatorAuthentication
{
    internal static async ValueTask<PackageRequestIdentity>
        AuthenticateOperatorRequest(
            ServerCallContext context,
            IReadOnlySet<KubernetesOperatorSubject> allowedSubjects)
    {
        if (context.RequestHeaders.Any(header =>
                string.Equals(
                    header.Key,
                    "authorization",
                    StringComparison.OrdinalIgnoreCase)
                || string.Equals(
                    header.Key,
                    "ctlflow-invocation",
                    StringComparison.OrdinalIgnoreCase)))
        {
            throw new TokenValidationException();
        }

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

        return new PackageRequestIdentity(
            new AuthenticatedPackageCaller.Operator(subject),
            null,
            PackageAdmission.Operator);
    }
}
