using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static ValueTask ValidateTypeMetadata(
        string apiVersion,
        string kind,
        string expectedKind,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!string.Equals(
                apiVersion,
                "tenancy.ctlflow.com/v1alpha1",
                StringComparison.Ordinal))
        {
            throw new InvalidFieldException(
                "apiVersion",
                "apiVersion is not supported",
                "FieldValueNotSupported");
        }

        if (!string.Equals(kind, expectedKind, StringComparison.Ordinal))
        {
            throw new InvalidFieldException(
                "kind",
                "kind does not match the requested resource",
                "FieldValueNotSupported");
        }

        return ValueTask.CompletedTask;
    }
}
