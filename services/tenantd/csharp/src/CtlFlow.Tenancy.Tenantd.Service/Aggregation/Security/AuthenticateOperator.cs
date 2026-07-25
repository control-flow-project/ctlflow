using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security;

internal static partial class AggregationAuthentication
{
    private const string ForwardedUserHeader = "X-Remote-User";

    internal static async ValueTask<RequestActor> AuthenticateOperator(
        HttpContext context,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (context.Connection.ClientCertificate is null)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status401Unauthorized,
                "Unauthorized",
                "Kubernetes aggregation authentication is required");
        }

        var values = context.Request.Headers[ForwardedUserHeader];
        if (values.Count != 1 || string.IsNullOrWhiteSpace(values[0]))
        {
            throw CreateAggregationFailure(
                StatusCodes.Status401Unauthorized,
                "Unauthorized",
                "Kubernetes operator identity is required");
        }

        try
        {
            return await RequestActor.Parse(values[0]!, cancellation);
        }
        catch (ArgumentException)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status401Unauthorized,
                "Unauthorized",
                "Kubernetes operator identity is invalid");
        }
    }
}
