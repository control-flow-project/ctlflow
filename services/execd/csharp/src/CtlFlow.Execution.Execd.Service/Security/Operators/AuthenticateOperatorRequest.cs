using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Callers;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using Grpc.Core;

namespace CtlFlow.Execution.Execd.Service.Security.Operators;

internal static partial class OperatorAuthentication
{
    internal static async ValueTask<ExecutionRequestIdentity>
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

        return new ExecutionRequestIdentity(
            new AuthenticatedExecutionCaller.Operator(subject),
            null,
            ExecutionAdmission.Operator);
    }
}
