using CtlFlow.Execution.Execd.Db.Workloads;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Packages.V1;
using static CtlFlow.Execution.Execd.Service.Packages.PackageAdmission;

namespace CtlFlow.Execution.Execd.Service.Workloads;

internal static partial class WorkloadAdmission
{
    internal static async Task<AdmittedWorkload> AdmitWorkload(
        PackageService.PackageServiceClient packageClient,
        ServiceSettings settings,
        ExecdTelemetry telemetry,
        PlacementRecord placement,
        WorkloadRequest requested,
        AdmittedPackageComponent? retainedPackage,
        CancellationToken cancellation)
    {
        var app = await GetApp(
            packageClient,
            settings.Package,
            telemetry,
            requested.PackageComponent.AppId,
            cancellation);
        var appAdmission = MapPackageApp(app);
        if (retainedPackage is not null)
        {
            if (appAdmission.PackageId != retainedPackage.PackageId)
            {
                throw new ExecutionException(
                    ExecutionError.Unavailable,
                    "Pkgd returned an invalid App");
            }

            appAdmission = appAdmission with
            {
                AppRevision = retainedPackage.AppRevision,
                PackageGeneration = retainedPackage.PackageGeneration
            };
        }

        var package = await GetPackage(
            packageClient,
            settings.Package,
            telemetry,
            appAdmission.PackageId,
            appAdmission.PackageGeneration,
            cancellation);
        var mapped = await MapPackage(
            appAdmission,
            package,
            cancellation);
        var admitted = await Domain.Workloads.Workloads.AdmitWorkload(
            placement,
            requested,
            mapped.Admission,
            settings.Provisioners.Subjects.Select(item =>
                new InstalledProvisioner(
                    item.Key,
                    item.Value)).ToArray(),
            cancellation);
        return new AdmittedWorkload(
            placement,
            admitted,
            new WorkloadWriteContent(
                admitted.Dependencies.Select(dependency =>
                    mapped.DependencyOptions.Single(item =>
                        item.ComponentId
                            == dependency.Selection.ComponentId
                        && item.DependencyName
                            == dependency.Selection.Name))
                    .ToArray()));
    }

}
