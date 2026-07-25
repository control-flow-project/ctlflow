using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<IReadOnlyList<BaselinePackageIntent>>
        ParseBaselinePackages(
            BaselinePackageDocument[]? documents,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (documents is null)
        {
            throw new InvalidFieldException(
                "spec.baselinePackages",
                "baselinePackages is required",
                "FieldValueRequired");
        }

        if (documents.Length > 64)
        {
            throw new InvalidFieldException(
                "spec.baselinePackages",
                "baselinePackages exceeds 64 entries");
        }

        var packages = new List<BaselinePackageIntent>(documents.Length);
        var packageIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var document in documents)
        {
            try
            {
                var packageId = await PackageId.Parse(
                    document.PackageId,
                    cancellation);
                if (!packageIds.Add(packageId.Value))
                {
                    throw new InvalidFieldException(
                        "spec.baselinePackages",
                        "baselinePackages contains a duplicate package ID",
                        "FieldValueDuplicate");
                }

                packages.Add(new BaselinePackageIntent(
                    packageId,
                    await PackageVersion.Parse(
                        document.PackageVersion,
                        cancellation)));
            }
            catch (ArgumentException exception)
            {
                throw new InvalidFieldException(
                    "spec.baselinePackages",
                    exception.Message);
            }
        }

        packages.Sort(static (left, right) =>
            string.CompareOrdinal(
                left.PackageId.Value,
                right.PackageId.Value));
        return packages;
    }
}
