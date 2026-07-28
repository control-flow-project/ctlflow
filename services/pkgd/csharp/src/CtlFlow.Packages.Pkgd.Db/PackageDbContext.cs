using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Db.Schema;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Packages.Pkgd.Db.Apps.AppSchema;
using static CtlFlow.Packages.Pkgd.Db.Content.DependencyOptionsContentSchema;
using static CtlFlow.Packages.Pkgd.Db.Packages.PackageSchema;
using static CtlFlow.Packages.Pkgd.Db.Schema.AppliedMigrationSchema;

namespace CtlFlow.Packages.Pkgd.Db;

public sealed class PackageDbContext(
    DbContextOptions<PackageDbContext> options) : DbContext(options)
{
    public DbSet<PackageDeclaration> PackageGenerations { get; private set; } =
        null!;

    public DbSet<PackageComponent> PackageComponents { get; private set; } =
        null!;

    public DbSet<PackageInterface> PackageInterfaces { get; private set; } =
        null!;

    public DbSet<PackageDependency> PackageDependencies { get; private set; } =
        null!;

    public DbSet<DependencyOptionsContentRow> PackageDependencyOptions
    {
        get;
        private set;
    } = null!;

    public DbSet<PackageExposure> PackageExposures { get; private set; } =
        null!;

    public DbSet<App> Apps { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } =
        null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigurePackageDeclaration(modelBuilder);
        ConfigurePackageComponent(modelBuilder);
        ConfigurePackageInterface(modelBuilder);
        ConfigurePackageDependency(modelBuilder);
        ConfigureDependencyOptionsContent(modelBuilder);
        ConfigurePackageExposure(modelBuilder);
        ConfigureApp(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
