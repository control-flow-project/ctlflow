using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageDependency(ModelBuilder modelBuilder)
    {
        var dependency = modelBuilder.Entity<PackageDependency>();
        dependency.ToTable("package_dependencies");
        dependency.Ignore(value => value.PackageId);
        dependency.Ignore(value => value.Generation);
        dependency.Ignore(value => value.ComponentId);
        dependency.Ignore(value => value.Name);
        dependency.Ignore(value => value.DependencyId);
        dependency.Ignore(value => value.DependencyType);
        dependency.Ignore(value => value.Options);
        dependency.HasKey(
            "_packageId",
            "_generation",
            "_componentId",
            "_dependencyName");
        dependency.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        dependency.Property<long>("_generation")
            .HasColumnName("generation").IsRequired();
        dependency.Property<string>("_componentId")
            .HasColumnName("component_id").HasMaxLength(64).IsRequired();
        dependency.Property<string>("_dependencyName")
            .HasColumnName("dependency_name").HasMaxLength(400).IsRequired();
        dependency.Property<string?>("_dependencyId")
            .HasColumnName("dependency_id").HasMaxLength(64).IsRequired(false);
        dependency.Property<string>("_dependencyType")
            .HasColumnName("dependency_type").HasMaxLength(128).IsRequired();
        dependency.HasIndex("_packageId", "_generation", "_dependencyId")
            .IsUnique();
        dependency.HasOne<PackageComponent>()
            .WithMany()
            .HasForeignKey("_packageId", "_generation", "_componentId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
