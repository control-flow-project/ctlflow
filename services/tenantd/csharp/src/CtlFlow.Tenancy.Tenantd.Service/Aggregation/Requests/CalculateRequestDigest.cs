using System.Globalization;
using System.Text;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static RequestDigest CalculateRequestDigest(
        IEnumerable<string> fields)
    {
        var canonical = new StringBuilder();
        foreach (var field in fields)
        {
            canonical.Append(
                field.Length.ToString(CultureInfo.InvariantCulture));
            canonical.Append(':');
            canonical.Append(field);
        }

        return RequestDigest.Calculate(canonical.ToString());
    }
}
