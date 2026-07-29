using CtlFlow.Execution.Execd.Db.Workloads;
using DomainPackageAdmission =
    CtlFlow.Execution.Execd.Domain.Workloads.PackageAdmission;

namespace CtlFlow.Execution.Execd.Service.Packages;

internal sealed record MappedPackageAdmission(
    DomainPackageAdmission Admission,
    IReadOnlyList<DependencyOptionsContent> DependencyOptions);
