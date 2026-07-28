using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageComponent(ModelBuilder modelBuilder)
    {
        var component = modelBuilder.Entity<PackageComponent>();
        component.ToTable("package_components");
        component.Ignore(value => value.PackageId);
        component.Ignore(value => value.Generation);
        component.Ignore(value => value.ComponentId);
        component.Ignore(value => value.Artifact);
        component.HasKey("_packageId", "_generation", "_componentId");
        component.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        component.Property<long>("_generation")
            .HasColumnName("generation").IsRequired();
        component.Property<string>("_componentId")
            .HasColumnName("component_id").HasMaxLength(64).IsRequired();
        component.Property<string>("_repository")
            .HasColumnName("repository").HasMaxLength(255).IsRequired();
        component.Property<string>("_manifestDigest")
            .HasColumnName("manifest_digest").HasMaxLength(71).IsRequired();
        component.HasOne<PackageDeclaration>()
            .WithMany()
            .HasForeignKey("_packageId", "_generation")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
