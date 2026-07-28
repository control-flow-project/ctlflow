using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Providers;

public sealed record PackageDatabase(
    IDbContextFactory<PackageDbContext> Contexts,
    PackageMutationCoordinator AcquireMutation);
